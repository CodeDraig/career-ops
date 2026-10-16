"""Local TLS fixture servers; never connects to a real mailbox or recipient."""
import importlib.util, pathlib, tempfile, subprocess, ssl, socket, threading, unittest, os
ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('transport', ROOT / 'lib/mail/transport.py')
mail = importlib.util.module_from_spec(spec); spec.loader.exec_module(mail)
RAW = b'Subject: =?utf-8?q?R=C3=A9ponse?=\r\nFrom: recruiter@example.com\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello https://example.com/jobs/123\r\n'

class Server:
    def __init__(self, context, kind, starttls=False):
        self.context, self.kind, self.commands, self.wire, self.errors = context, kind, [], b'', []
        self.starttls = starttls
        self.sock = socket.socket(); self.sock.bind(('127.0.0.1', 0)); self.sock.listen(); self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self.serve, daemon=True); self.thread.start()
    def serve(self):
        try:
            conn, _ = self.sock.accept()
            with (conn if self.starttls else self.context.wrap_socket(conn, server_side=True)) as conn:
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
                        elif upper.startswith(b'EXAMINE'): send(b'* 1 EXISTS\r\n* OK [UIDVALIDITY 7] stable\r\n' + tag + b' OK [READ-ONLY] selected\r\n')
                        elif upper.startswith(b'UID SEARCH'): send(b'* SEARCH 9\r\n' + tag + b' OK search\r\n')
                        elif b'RFC822.SIZE' in upper: send(b'* 1 FETCH (UID 9 RFC822.SIZE ' + str(len(RAW)).encode() + b')\r\n' + tag + b' OK size\r\n')
                        elif b'BODY.PEEK[]' in upper: send(b'* 1 FETCH (UID 9 INTERNALDATE "16-Oct-2026 12:00:00 +0000" BODY[] {' + str(len(RAW)).encode() + b'}\r\n' + RAW + b')\r\n' + tag + b' OK body\r\n')
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
        finally: self.sock.close()
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
