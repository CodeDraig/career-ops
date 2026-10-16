import '../helpers/web-ts-alias-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { GET, POST } = await import('../../src/app/api/mail/route.ts');
const send = (body, origin = 'http://localhost') => POST(new Request('http://localhost/api/mail', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
test('mail route rejects cross-origin send and unsupported actions', async () => {
  assert.equal((await send({ action: 'send' }, 'https://foreign.example')).status, 403);
  assert.equal((await send({ action: 'delete' })).status, 400);
  assert.equal((await POST(new Request('http://localhost/api/mail', { method: 'POST', headers: { origin: 'http://localhost', 'Content-Type': 'application/json' }, body: '{' }))).status, 400);
});
test('mail web route uses core with separate data root and freezes the reviewed email', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-web-'));
  const before = { ...process.env };
  try {
    process.env.CAREER_OPS_ROOT = root;
    process.env.CAREER_OPS_CODE_ROOT = path.resolve(import.meta.dirname, '../../..');
    delete process.env.CAREER_OPS_MAIL_CONFIG;
    assert.deepEqual(await (await GET()).json(), { accounts: [] });
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config/mail.json'), JSON.stringify({ accounts: [{ id: 'fixture', from: 'sender@example.com', smtp: { host: 'localhost', port: 465, security: 'tls', user: 'sender@example.com', secretEnv: 'MAIL_WEB_MISSING' } }] }));
    const response = await send({ action: 'prepare', account: 'fixture', draft: { to: ['recipient@example.com'], subject: 'Web fixture', body: 'Reviewed content' } });
    assert.equal(response.status, 200); const prepared = await response.json();
    assert.equal(prepared.payload.draft.body, 'Reviewed content');
    assert.ok(fs.existsSync(path.join(root, 'data/mail/outbox', prepared.id + '.json')));
    const normalized = await POST(new Request('http://localhost:3197/api/mail', { method: 'POST', headers: { origin: 'http://127.0.0.1:3197', host: '127.0.0.1:3197', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'review', id: prepared.id }) }));
    assert.equal(normalized.status, 200, 'Next hostname normalization must not reject the actual browser origin');
    const review = await send({ action: 'review', id: prepared.id }); assert.equal((await review.json()).receipt, null);
    const badSend = await send({ action: 'send', id: prepared.id, confirm: 'wrong' }); assert.equal(badSend.status, 400);
    assert.equal(fs.readdirSync(path.join(root, 'data/mail/outbox')).length, 1);
    assert.ok(!fs.existsSync(path.join(root, 'data/applications.md')));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
