"""Local TLS fixture servers; never connects to a real mailbox or recipient."""
import importlib.util, pathlib, tempfile, subprocess, ssl, socket, threading, unittest, os, re
from email.parser import BytesParser
from email import policy
ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('transport', ROOT / 'lib/mail/transport.py')
mail = importlib.util.module_from_spec(spec); spec.loader.exec_module(mail)
RAW = b'Subject: =?utf-8?q?R=C3=A9ponse?=\r\nFrom: Recruiter Name <recruiter@example.com>\r\nReply-To: Reply Desk <reply@example.com>\r\nTo: Candidate <candidate@example.com>\r\nCc: Observer <observer@example.com>\r\nMessage-ID: <inbound@example.com>\r\nIn-Reply-To: <parent@example.com>\r\nReferences: <root@example.com> <parent@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello https://example.com/jobs/123\r\n'

class Server:
    def __init__(self, context, kind, starttls=False, uids=(9,), validity='7', raws=None, oversized=(), bad_fetch=()):
        self.context, self.kind, self.commands, self.wire, self.errors = context, kind, [], b'', []
        self.uids, self.validity = tuple(uids), str(validity)
        self.raws = raws or {uid: RAW for uid in self.uids}; self.oversized = set(oversized); self.bad_fetch = set(bad_fetch)
        self.starttls = starttls
        self.sock = socket.socket(); self.sock.bind(('127.0.0.1', 0)); self.sock.listen(); self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self.serve, daemon=True); self.thread.start()
    def serve(self):
        raw_conn = conn = f = None
        try:
            raw_conn, _ = self.sock.accept(); conn = raw_conn
            if not self.starttls: conn = self.context.wrap_socket(raw_conn, server_side=True)
            conn.settimeout(10); f = conn.makefile('rwb')
            def send(s): f.write(s); f.flush()
            send(b'* OK fixture\r\n' if self.kind == 'imap' else b'220 localhost fixture\r\n')
            while True:
                line = f.readline()
                if not line: break
                self.commands.append(line.decode().strip())
                if self.kind == 'imap':
                    tag, cmd = line.split(b' ', 1); upper = cmd.upper()
                    if upper.startswith(b'CAPABILITY'): send(b'* CAPABILITY IMAP4rev1 STARTTLS\r\n' + tag + b' OK capability\r\n')
                    elif upper.startswith(b'STARTTLS'):
                        send(tag + b' OK upgrade\r\n'); f.close(); conn = self.context.wrap_socket(conn, server_side=True); f = conn.makefile('rwb')
                    elif upper.startswith(b'LOGIN'): send(tag + b' OK login\r\n')
                    elif upper.startswith(b'EXAMINE'): send(b'* 1 EXISTS\r\n* OK [UIDVALIDITY ' + self.validity.encode() + b'] stable\r\n' + tag + b' OK [READ-ONLY] selected\r\n')
                    elif upper.startswith(b'UID SEARCH'): send(b'* SEARCH ' + b' '.join(str(uid).encode() for uid in self.uids) + b'\r\n' + tag + b' OK search\r\n')
                    elif b'RFC822.SIZE' in upper:
                        uid = int(re.search(rb'UID FETCH (\d+)', upper)[1]); raw = self.raws[uid]
                        size = 5_000_001 if uid in self.oversized else len(raw)
                        send(b'* 1 FETCH (UID ' + str(uid).encode() + b' RFC822.SIZE ' + str(size).encode() + b')\r\n' + tag + b' OK size\r\n')
                    elif b'BODY.PEEK[]' in upper:
                        uid = int(re.search(rb'UID FETCH (\d+)', upper)[1])
                        if uid in self.bad_fetch: send(tag + b' NO fixture fetch failure\r\n')
                        else:
                            raw = self.raws[uid]
                            send(b'* 1 FETCH (UID ' + str(uid).encode() + b' INTERNALDATE "16-Oct-2026 12:00:00 +0000" BODY[] {' + str(len(raw)).encode() + b'}\r\n' + raw + b')\r\n' + tag + b' OK body\r\n')
                    elif upper.startswith(b'LOGOUT'): send(b'* BYE bye\r\n' + tag + b' OK logout\r\n'); break
                    else: send(tag + b' BAD forbidden\r\n')
                else:
                    upper = line.upper()
                    if upper.startswith(b'EHLO'): send(b'250-localhost\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n')
                    elif upper.startswith(b'STARTTLS'):
                        send(b'220 upgrade\r\n'); f.close(); conn = self.context.wrap_socket(conn, server_side=True); f = conn.makefile('rwb')
                    elif upper.startswith(b'AUTH'): send(b'235 authenticated\r\n')
                    elif upper.startswith(b'MAIL'): send(b'250 sender\r\n')
                    elif upper.startswith(b'RCPT'): send(b'550 refused\r\n' if b'refused@' in line else b'250 recipient\r\n')
                    elif upper.startswith(b'DATA'):
                        send(b'354 continue\r\n')
                        while True:
                            chunk = f.readline()
                            if chunk == b'.\r\n': break
                            self.wire += chunk
                        send(b'250 accepted\r\n')
                    elif upper.startswith(b'QUIT'): send(b'221 bye\r\n'); break
                    else: send(b'250 ok\r\n')
        except ssl.SSLError: pass  # certificate rejection test
        except Exception as e: self.errors.append(str(e))
        finally:
            for resource in (f, conn, raw_conn, self.sock):
                if resource is not None:
                    try: resource.close()
                    except OSError: pass
    def join(self):
        self.thread.join(12)
        assert not self.thread.is_alive(), 'fixture stuck'
        assert not self.errors, self.errors

class Protocol(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(); cls.cert = str(pathlib.Path(cls.tmp.name) / 'cert.pem'); key = str(pathlib.Path(cls.tmp.name) / 'key.pem')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cls.cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); cls.context.load_cert_chain(cls.cert, key)
        os.environ['MAIL_PROTOCOL_TEST_SECRET'] = 'fixture'
    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()
    def config(self, server): return dict(host='localhost', port=server.port, security='tls', user='sender@example.com', secretEnv='MAIL_PROTOCOL_TEST_SECRET', caFile=self.cert)
    def test_imap_readonly_and_identity(self):
        server = Server(self.context, 'imap')
        result = mail.run(dict(action='fetch', config=self.config(server), mailbox='INBOX', since='01-Oct-2026', limit=20)); server.join()
        message = result['messages'][0]
        self.assertEqual(message['subject'], 'Réponse'); self.assertEqual(message['links'], ['https://example.com/jobs/123'])
        self.assertEqual(message['from'], 'Recruiter Name <recruiter@example.com>')
        self.assertEqual(message['fromAddresses'], ['recruiter@example.com'])
        self.assertEqual(message['replyTo'], ['reply@example.com']); self.assertEqual(message['to'], ['candidate@example.com'])
        self.assertEqual(message['cc'], ['observer@example.com']); self.assertEqual(message['rfcMessageId'], '<inbound@example.com>')
        self.assertEqual(message['inReplyTo'], ['<parent@example.com>'])
        self.assertEqual(message['references'], ['<root@example.com>', '<parent@example.com>'])
        self.assertEqual(message['received_at'], '2026-10-16T12:00:00+00:00')
        commands = '\n'.join(server.commands); self.assertIn('EXAMINE', commands); self.assertIn('BODY.PEEK[]', commands)
        for forbidden in [' SELECT ', ' STORE ', ' EXPUNGE', ' CLOSE']: self.assertNotIn(forbidden, commands)
    def test_smtp_partial_and_bcc(self):
        draft = dict(to=['accepted@example.com'], cc=[], bcc=['refused@example.com'], subject='Test', body='Only fixture content', attachments=[], **{'from': 'sender@example.com'})
        encoded = mail.run(dict(action='encode', draft=draft))
        server = Server(self.context, 'smtp')
        result = mail.run(dict(action='send', config=self.config(server), wire=encoded['wire'], sender=draft['from'], recipients=draft['to'] + draft['bcc'])); server.join()
        self.assertEqual(result['status'], 'partial'); self.assertEqual(result['accepted'], draft['to']); self.assertEqual(result['refused'], draft['bcc'])
        self.assertNotIn(b'Bcc:', server.wire); self.assertIn(b'Only fixture content', server.wire)
    def test_encode_preserves_threading_and_returns_wire_message_id(self):
        draft = dict(to=['accepted@example.com'], cc=[], subject='Re: Test', body='Reply body', attachments=[],
                     inReplyTo=['<parent@example.com>'], references=['<root@example.com>', '<parent@example.com>'], **{'from': 'sender@example.com'})
        encoded = mail.run(dict(action='encode', draft=draft))
        msg = BytesParser(policy=policy.default).parsebytes(__import__('base64').b64decode(encoded['wire']))
        self.assertEqual(str(msg['Message-ID']), encoded['rfcMessageId'])
        self.assertEqual(str(msg['In-Reply-To']), '<parent@example.com>')
        self.assertEqual(str(msg['References']), '<root@example.com> <parent@example.com>')
    def test_encode_rejects_header_injection_and_bad_thread_ids(self):
        for field, value in [('subject', 'hello\r\nBcc: victim@example.com'), ('from', 'sender@example.com\nBcc: victim@example.com')]:
            draft = dict(to=['accepted@example.com'], cc=[], subject='Test', body='body', attachments=[], **{'from': 'sender@example.com'})
            draft[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): mail.run(dict(action='encode', draft=draft))
        draft = dict(to=[], cc=[], subject='Test', body='body', attachments=[], inReplyTo=['<ok@example.com>\r\nBcc: victim@example.com'], **{'from': 'sender@example.com'})
        with self.assertRaises(ValueError): mail.run(dict(action='encode', draft=draft))
    def test_sync_pages_by_uid_and_uidvalidity_reset(self):
        args = dict(config=None, mailbox='INBOX', since='01-Oct-2026', limit=2, afterUid=0)
        server = Server(self.context, 'imap', uids=(4, 7, 9)); args['config'] = self.config(server)
        first = mail.run(dict(action='sync', **args)); server.join()
        self.assertEqual([m['uid'] for m in first['messages']], ['4', '7'])
        self.assertEqual(first['lastUid'], 7); self.assertTrue(first['hasMore']); self.assertEqual(first['uidValidity'], '7')
        commands = '\n'.join(server.commands); self.assertIn('EXAMINE', commands); self.assertIn('BODY.PEEK[]', commands)
        for forbidden in [' SELECT ', ' STORE ', ' EXPUNGE', ' CLOSE']: self.assertNotIn(forbidden, commands)
        server = Server(self.context, 'imap', uids=(4, 7, 9)); args['config'] = self.config(server); args.update(afterUid=7, uidValidity='7')
        second = mail.run(dict(action='sync', **args)); server.join()
        self.assertEqual([m['uid'] for m in second['messages']], ['9']); self.assertEqual(second['lastUid'], 9); self.assertFalse(second['hasMore'])
        server = Server(self.context, 'imap', uids=(3, 4), validity='8'); args['config'] = self.config(server); args.update(afterUid=99, uidValidity='7')
        reset = mail.run(dict(action='sync', **args)); server.join()
        self.assertTrue(reset['reset']); self.assertEqual([m['uid'] for m in reset['messages']], ['3', '4'])
        self.assertEqual(reset['lastUid'], 4); self.assertFalse(reset['hasMore'])
    def test_sync_oversize_uid_advances_processed_cursor(self):
        server = Server(self.context, 'imap', uids=(2, 5), oversized=(2,))
        result = mail.run(dict(action='sync', config=self.config(server), mailbox='INBOX', since='01-Oct-2026', limit=1, afterUid=0)); server.join()
        self.assertEqual(result['messages'], []); self.assertEqual(result['skippedOversize'], 1)
        self.assertEqual(result['lastUid'], 2); self.assertTrue(result['hasMore'])
    def test_sync_fetch_failure_returns_no_cursor_page(self):
        server = Server(self.context, 'imap', uids=(3,), bad_fetch=(3,))
        with self.assertRaises(ValueError):
            mail.run(dict(action='sync', config=self.config(server), mailbox='INBOX', since='01-Oct-2026', limit=1, afterUid=0))
        server.join()
    def test_html_and_bad_charset_are_inert_text(self):
        raw = b'Content-Type: text/html; charset=made-up\r\nSubject: Untrusted\r\n\r\n<script>steal()</script><p>Hello &amp; goodbye <a href="https://example.com/job">job</a></p>'
        result = mail.decode_message(raw)
        self.assertNotIn('steal()', result['body_snippet'])
        self.assertIn('Hello & goodbye', result['body_snippet'])
        self.assertEqual(result['links'], ['https://example.com/job'])
    def test_starttls_before_authentication(self):
        for kind in ['imap', 'smtp']:
            server = Server(self.context, kind, starttls=True); config = self.config(server); config['security'] = 'starttls'
            client = mail.connect(config, kind)
            if kind == 'imap': client.logout()
            else: client.quit()
            server.join()
            upgrade = next(i for i, cmd in enumerate(server.commands) if 'STARTTLS' in cmd)
            auth = next(i for i, cmd in enumerate(server.commands) if 'LOGIN' in cmd or cmd.startswith('AUTH'))
            self.assertLess(upgrade, auth)
    def test_untrusted_certificate_rejected(self):
        server = Server(self.context, 'smtp'); config = self.config(server); del config['caFile']
        with self.assertRaises(ssl.SSLCertVerificationError): mail.connect(config, 'smtp')
        server.join()

if __name__ == '__main__': unittest.main()
