"""Bounded, TLS-only mail transport. JSON stdin/stdout; never log credentials."""
import sys, json, os, ssl, imaplib, smtplib, email, re, hashlib
from email import policy
from email.parser import BytesParser
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from html.parser import HTMLParser
import base64
import datetime, time

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []; self.hidden = 0; self.links = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.hidden += 1
        if tag in ('p', 'br', 'div'): self.parts.append('\n')
        if tag == 'a':
            self.links.extend(v for k, v in attrs if k == 'href' and v and v.startswith(('https://', 'http://')))
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)

def decode_message(raw):
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    part = msg.get_body(preferencelist=('plain', 'html'))
    payload = part.get_payload(decode=True) if part else b''
    try: body = (payload or b'').decode(part.get_content_charset() or 'utf-8', errors='replace') if part else ''
    except LookupError: body = (payload or b'').decode('utf-8', errors='replace')
    links = re.findall(r'https?://[^\s<>\"]+', body)
    if part and part.get_content_type() == 'text/html':
        parser = Text(); parser.feed(body); body = ''.join(parser.parts); links = parser.links
    return dict(subject=str(msg.get('Subject', '')), **{'from': str(msg.get('From', ''))},
                links=list(dict.fromkeys(links))[:100], body_snippet=body[:20000], truncated=len(body) > 20000,
                attachments=[str(p.get_filename() or 'attachment') for p in msg.iter_attachments()])

def connect(config, kind):
    context = ssl.create_default_context(cafile=config.get('caFile'))
    host, port = config['host'], config['port']
    if kind == 'imap':
        client = imaplib.IMAP4_SSL(host, port, ssl_context=context, timeout=30) if config['security'] == 'tls' else imaplib.IMAP4(host, port, timeout=30)
        if config['security'] == 'starttls': client.starttls(ssl_context=context)
    else:
        client = smtplib.SMTP_SSL(host, port, context=context, timeout=30) if config['security'] == 'tls' else smtplib.SMTP(host, port, timeout=30)
        client.ehlo()
        if config['security'] == 'starttls': client.starttls(context=context); client.ehlo()
    secret = os.environ[config['secretEnv']]
    if config.get('auth', 'password') == 'oauth2':
        value = f"user={config['user']}\x01auth=Bearer {secret}\x01\x01"
        if kind == 'imap': client.authenticate('XOAUTH2', lambda challenge: value.encode() if not challenge else b'')
        else: client.auth('XOAUTH2', lambda challenge=None: value if challenge is None else '')
    else: client.login(config['user'], secret)
    return client

def run(req):
    action = req['action']
    if action == 'encode':
        d = req['draft']; msg = EmailMessage()
        for name in ('From', 'To', 'Cc', 'Subject'):
            value = d.get(name.lower())
            if value: msg[name] = ', '.join(value) if isinstance(value, list) else value
        msg['Date'] = formatdate(localtime=False); msg['Message-ID'] = make_msgid()
        msg.set_content(d['body'])
        for a in d['attachments']:
            msg.add_attachment(base64.b64decode(a['dataBase64'], validate=True), maintype='application', subtype='octet-stream', filename=a['name'])
        return {'wire': base64.b64encode(msg.as_bytes(policy=policy.SMTP)).decode()}
    client = connect(req['config'], 'imap' if action == 'fetch' else 'smtp')
    try:
        if action == 'fetch':
            mailbox = req.get('mailbox', 'INBOX')
            status, _ = client.select('"' + mailbox.replace('\\', '\\\\').replace('"', '\\"') + '"', readonly=True)
            if status != 'OK': raise ValueError('mailbox')
            validity = client.response('UIDVALIDITY')[1][0].decode()
            status, data = client.uid('search', None, 'SINCE', req['since'])
            if status != 'OK': raise ValueError('search')
            messages = []; skipped = 0
            for uid in data[0].split()[-req['limit']:][::-1]:
                status, size = client.uid('fetch', uid, '(RFC822.SIZE)')
                match = re.search(rb'RFC822.SIZE (\d+)', b' '.join(x for x in size if isinstance(x, bytes)))
                if status != 'OK' or not match or int(match[1]) > 5_000_000: skipped += 1; continue
                status, data = client.uid('fetch', uid, '(BODY.PEEK[] INTERNALDATE)')
                if status != 'OK': raise ValueError('fetch')
                item = next(x for x in data if isinstance(x, tuple))
                parsed = decode_message(item[1]); parsed['uid'] = uid.decode()
                received = imaplib.Internaldate2tuple(item[0])
                if received: parsed['received_at'] = datetime.datetime.fromtimestamp(time.mktime(received), datetime.timezone.utc).isoformat()
                identity = json.dumps([req['config']['host'], req['config']['port'], req['config']['user'], mailbox, validity, parsed['uid']])
                parsed['message_id'] = 'imap-' + hashlib.sha256(identity.encode()).hexdigest()
                parsed['signal'] = None
                messages.append(parsed)
            return {'messages': messages, 'skippedOversize': skipped, 'uidValidity': validity}
        refused = client.sendmail(req['sender'], req['recipients'], base64.b64decode(req['wire']))
        return {'status': 'partial' if refused else 'accepted', 'refused': list(refused), 'accepted': [x for x in req['recipients'] if x not in refused]}
    finally:
        try:
            if action == 'fetch': client.logout()
            else: client.quit()
        except Exception: pass

if __name__ == '__main__':
    try: print(json.dumps(run(json.load(sys.stdin))))
    except Exception as exc:
        # Server exception strings may contain message bodies or authentication data.
        print(json.dumps({'error': 'Mail transport failed: ' + type(exc).__name__})); sys.exit(1)
