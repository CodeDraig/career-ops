import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mail, transport } from '../lib/mail/core.mjs';
const codeRoot = path.resolve(import.meta.dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-mail-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'));
  const config = { accounts: [{ id: 'test', from: 'sender@example.com', imap: { host: 'localhost', port: 993, security: 'tls', user: 'sender@example.com', secretEnv: 'MAIL_TEST_SECRET' }, smtp: { host: 'localhost', port: 587, security: 'starttls', user: 'sender@example.com', secretEnv: 'MAIL_TEST_SECRET' } }] };
  fs.writeFileSync(path.join(root, 'config/mail.json'), JSON.stringify(config));
  const old = process.env.MAIL_TEST_SECRET; process.env.MAIL_TEST_SECRET = 'fixture-only';
  t.after(() => { if (old === undefined) delete process.env.MAIL_TEST_SECRET; else process.env.MAIL_TEST_SECRET = old; });
  return { root, config };
}
const draft = { to: ['recipient@example.com'], bcc: ['hidden@example.com'], subject: 'Test', body: 'Reviewed body', attachments: [{ name: 'cv.txt', dataBase64: Buffer.from('fixture attachment').toString('base64') }] };
test('mail: absent vs malformed configuration, secrets never returned', async t => {
  const { root } = fixture(t);
  const result = await mail({ action: 'accounts' }, { root });
  assert.equal(result.accounts[0].from, 'sender@example.com');
  assert.ok(!JSON.stringify(result).includes('fixture-only'));
  fs.writeFileSync(path.join(root, 'config/mail.json'), '{broken');
  await assert.rejects(mail({ action: 'accounts' }, { root }), /Cannot parse/);
  fs.unlinkSync(path.join(root, 'config/mail.json'));
  assert.deepEqual(await mail({ action: 'accounts' }, { root }), { accounts: [] });
});
test('mail: imported snapshots deduplicate and preserve malformed candidates', async t => {
  const { root } = fixture(t);
  const options = { root, run: async req => { assert.equal(req.action, 'fetch'); assert.equal(req.since, '01-Oct-2026'); return { messages: [{ message_id: 'imap-test', subject: 'Reply', from: 'r@example.com', body_snippet: 'hello', signal: null }], skippedOversize: 0 }; } };
  const batch = await mail({ action: 'fetch', account: 'test', since: '2026-10-01' }, options);
  const request = { action: 'import', id: batch.id, ids: ['imap-test'] };
  const imports = await Promise.all([mail(request, options), mail(request, options)]);
  assert.equal(imports.reduce((total, result) => total + result.added, 0), 1);
  assert.equal((await mail(request, options)).added, 0);
  assert.deepEqual(await mail({ action: 'history' }, options), { drafts: [] });
  await assert.rejects(mail({ ...request, ids: ['unfetched'] }, options), /Select messages/);
  const target = path.join(root, 'data/reply-candidates.json');
  fs.writeFileSync(target, 'broken'); await assert.rejects(mail(request, options)); assert.equal(fs.readFileSync(target, 'utf8'), 'broken');
  assert.ok(!fs.existsSync(path.join(root, 'data/applications.md')));
});
test('mail: frozen MIME, Bcc, confirmation and one send under concurrency', async t => {
  const { root } = fixture(t); let sends = 0;
  const run = async request => {
    if (request.action === 'encode') return transport(request);
    sends++; assert.deepEqual(request.recipients, ['recipient@example.com', 'hidden@example.com']);
    const wire = Buffer.from(request.wire, 'base64').toString();
    assert.match(wire, /Reviewed body/); assert.doesNotMatch(wire, /Bcc:|hidden@example.com/);
    assert.match(wire, /filename="cv.txt"/);
    await new Promise(resolve => setTimeout(resolve, 40)); return { status: 'accepted', accepted: request.recipients, refused: [] };
  };
  const prepared = await mail({ action: 'prepare', account: 'test', draft }, { root, run });
  assert.equal(prepared.payload.draft.attachments[0].bytes, Buffer.byteLength('fixture attachment'));
  assert.match(prepared.payload.draft.attachments[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(path.join(root, 'data/mail/outbox', prepared.id + '.json')).mode & 0o777, 0o600);
  await assert.rejects(mail({ action: 'send', id: prepared.id, confirm: 'wrong' }, { root, run }), /reviewed digest/);
  assert.equal(sends, 0);
  const request = { action: 'send', id: prepared.id, confirm: prepared.digest };
  const results = await Promise.allSettled([mail(request, { root, run }), mail(request, { root, run })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(sends, 1);
  const reviewed = await mail({ action: 'review', id: prepared.id }, { root, run }); assert.equal(reviewed.receipt.status, 'accepted');
  const history = await mail({ action: 'history' }, { root });
  assert.deepEqual(history.drafts.map(d => [d.id, d.status]), [[prepared.id, 'accepted']]);
});
test('mail: failure is durable and cannot be retried', async t => {
  const { root } = fixture(t);
  const run = async req => req.action === 'encode' ? transport(req) : Promise.reject(new Error('connection lost'));
  const prepared = await mail({ action: 'prepare', account: 'test', draft }, { root, run });
  const request = { action: 'send', id: prepared.id, confirm: prepared.digest };
  assert.equal((await mail(request, { root, run })).status, 'unknown');
  await assert.rejects(mail(request, { root, run }), /already attempted/);
});
test('mail: changed payload or SMTP configuration requires review again', async t => {
  const { root, config } = fixture(t);
  const prepared = await mail({ action: 'prepare', account: 'test', draft }, { root });
  config.accounts[0].smtp.host = 'other.example.com'; fs.writeFileSync(path.join(root, 'config/mail.json'), JSON.stringify(config));
  await assert.rejects(mail({ action: 'send', id: prepared.id, confirm: prepared.digest }, { root }), /configuration changed/);
  const file = path.join(root, 'data/mail/outbox', prepared.id + '.json');
  const saved = JSON.parse(fs.readFileSync(file)); saved.payload.draft.to = ['other@example.com']; fs.writeFileSync(file, JSON.stringify(saved));
  await assert.rejects(mail({ action: 'review', id: prepared.id }, { root }), /Prepared mail changed/);
});
test('mail: validation rejects headers, paths, plaintext and excessive fetches', async t => {
  const { root, config } = fixture(t);
  for (const change of [{ subject: 'x\r\nBcc: x@example.com' }, { to: ['x@example.com\n'] }, { to: ['a\"b@example.com'] }, { attachments: [{ name: '../secret', dataBase64: 'YQ==' }] }]) {
    await assert.rejects(mail({ action: 'prepare', account: 'test', draft: { ...draft, ...change } }, { root }));
  }
  await assert.rejects(mail({ action: 'fetch', account: 'test', limit: 51 }, { root }), /1–50/);
  await assert.rejects(mail({ action: 'review', id: '../../config/mail' }, { root }), /Invalid mail id/);
  config.accounts[0].smtp.security = 'none'; fs.writeFileSync(path.join(root, 'config/mail.json'), JSON.stringify(config));
  await assert.rejects(mail({ action: 'accounts' }, { root }), /Invalid mail transport/);
});
test('mail: CLI uses external data root from unrelated cwd and rejects flags', t => {
  const { root } = fixture(t);
  const result = spawnSync(process.execPath, [path.join(codeRoot, 'mail.mjs'), '--request'], { cwd: os.tmpdir(), env: { ...process.env, CAREER_OPS_ROOT: root }, input: JSON.stringify({ action: 'accounts' }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).accounts[0].id, 'test');
  const bad = spawnSync(process.execPath, [path.join(codeRoot, 'mail.mjs'), '--bad'], { encoding: 'utf8' }); assert.equal(bad.status, 1);
});
test('mail: real TLS IMAP and SMTP fixture protocol checks', () => {
  const result = spawnSync('python3', [path.join(codeRoot, 'tests/mail-protocol.py')], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('mail: selected source links use canonical pipeline writers in a separate root', t => {
  const { root } = fixture(t);
  const id = '12345678-1234-1234-1234-123456789abc';
  fs.mkdirSync(path.join(root, 'data/mail/outbox'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/mail/outbox', id + '.json'), JSON.stringify({ kind: 'inbox', messages: [{ message_id: 'imap-fixture', subject: 'Support engineer', links: ['https://example.com/jobs/123'] }] }));
  const call = url => spawnSync(process.execPath, [path.join(codeRoot, 'mail.mjs'), '--request'], { cwd: os.tmpdir(), env: { ...process.env, CAREER_OPS_ROOT: root }, input: JSON.stringify({ action: 'lead', id, messageId: 'imap-fixture', url }), encoding: 'utf8' });
  assert.equal(call('https://example.com/unsolicited').status, 1);
  const result = call('https://example.com/jobs/123'); assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(root, 'data/pipeline.md'), 'utf8'), /example.com\/jobs\/123/);
  assert.match(fs.readFileSync(path.join(root, 'data/scan-history.tsv'), 'utf8'), /example.com\/jobs\/123/);
  assert.ok(!fs.existsSync(path.join(root, 'data/applications.md')));
});
