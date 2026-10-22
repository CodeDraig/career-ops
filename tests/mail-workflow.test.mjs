import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mail } from '../lib/mail/core.mjs';
import { analyzeFromContent, parseFollowups } from '../followup-cadence.mjs';

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-mail-flow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const config = { accounts: [{ id: 'primary', from: 'me@example.com', imap: { host: 'imap.example.com', port: 993, security: 'tls', user: 'me@example.com', secretEnv: 'MAIL_FLOW_SECRET' }, smtp: { host: 'smtp.example.com', port: 465, security: 'tls', user: 'me@example.com', secretEnv: 'MAIL_FLOW_SECRET' } }] };
  fs.writeFileSync(path.join(root, 'config/mail.json'), JSON.stringify(config));
  const oldSecret = process.env.MAIL_FLOW_SECRET, oldTracker = process.env.CAREER_OPS_TRACKER, oldFollowups = process.env.CAREER_OPS_FOLLOWUPS;
  process.env.MAIL_FLOW_SECRET = 'test-only'; delete process.env.CAREER_OPS_TRACKER; delete process.env.CAREER_OPS_FOLLOWUPS;
  t.after(() => { for (const [key, val] of [['MAIL_FLOW_SECRET', oldSecret], ['CAREER_OPS_TRACKER', oldTracker], ['CAREER_OPS_FOLLOWUPS', oldFollowups]]) { if (val === undefined) delete process.env[key]; else process.env[key] = val; } });
  const trackerPath = path.join(root, 'data/applications.md');
  const tracker = (company = 'Acme', role = 'Support Engineer') => fs.writeFileSync(trackerPath,
    `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-10-01 | ${company} | ${role} | 4/5 | Applied | — | report-1.md | — |\n`);
  tracker();
  return { root, tracker, trackerPath };
}
const msg = (id, uid, subject = 'Support Engineer at Acme') => ({ message_id: id, uid: String(uid), rfcMessageId: `<${id}@mail.example>`, subject, from: 'Recruiting <recruiter@acme.example>', fromAddresses: ['recruiter@acme.example'], replyTo: ['reply@acme.example'], to: ['me@example.com'], cc: [], inReplyTo: [], references: [], body_snippet: 'Your Support Engineer application at Acme', received_at: '2026-10-20T10:00:00Z' });
const localDateOf = value => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('sync pages durably, resumes cursors, serializes same account and resets on UIDVALIDITY changes', async t => {
  const { root } = setup(t); const calls = [];
  const run = async req => {
    if (req.action !== 'sync') return {};
    calls.push(req.afterUid);
    if (req.afterUid === '0') return { messages: [msg('m1', 1)], uidValidity: '7', lastUid: '1', hasMore: true };
    if (req.afterUid === '1') return { messages: [msg('m2', 2)], uidValidity: '7', lastUid: '2', hasMore: false };
    return { messages: [], uidValidity: '7', lastUid: req.afterUid, hasMore: false };
  };
  const request = { action: 'sync', account: 'primary', since: '2026-10-01', limit: 1, maxPages: 4 };
  const [a, b] = await Promise.all([mail(request, { root, run }), mail(request, { root, run })]);
  assert.equal(a.messages.length + b.messages.length, 2);
  assert.deepEqual(calls, ['0', '1', '2']);
  assert.equal(fs.readdirSync(path.join(root, 'data/mail/messages')).length, 2);
  const reset = await mail(request, { root, run: async req => ({ messages: [msg('m3', 1)], uidValidity: '8', lastUid: '1', hasMore: false, reset: req.uidValidity !== '8' }) });
  assert.equal(reset.messages[0].transportMessageId, 'm3');
  const backfill = await mail({ ...request, since: '2026-09-01' }, { root, run: async req => { assert.equal(req.afterUid, '0'); return { messages: [], uidValidity: '8', lastUid: '0', hasMore: false }; } });
  assert.equal(backfill.messages.length, 0);
  await assert.rejects(mail({ ...request, since: '2026-08-01' }, { root, run: async () => { throw new Error('offline'); } }), /offline/);
  await mail({ ...request, since: '2026-08-01' }, { root, run: async req => { assert.equal(req.afterUid, '0'); return { messages: [], uidValidity: '8', lastUid: '0', hasMore: false }; } });
});

test('explicit match binds a canonical application; suggestions do not, threaded reply prepares RFC headers', async t => {
  const { root, tracker } = setup(t);
  const run = async req => req.action === 'sync'
    ? { messages: [msg('incoming-1', 1)], uidValidity: '7', lastUid: '1', hasMore: false }
    : req.action === 'encode' ? { wire: Buffer.from('mime').toString('base64'), rfcMessageId: '<outgoing@mail.example>' } : {};
  const synced = await mail({ action: 'sync', account: 'primary', since: '2026-10-01' }, { root, run });
  const incomingId = synced.messages[0].message_id;
  const listed = await mail({ action: 'messages' }, { root });
  assert.equal(listed.messages[0].application, null);
  assert.equal(listed.messages[0].suggestions[0].appNum, 1);
  const bound = await mail({ action: 'match', messageId: incomingId, appNum: 1 }, { root });
  assert.equal(bound.application.num, 1);
  const reply = await mail({ action: 'reply', messageId: incomingId }, { root });
  assert.equal(reply.association, 'confirmed-match');
  const prepared = await mail({ action: 'prepare', account: 'primary', messageId: incomingId, draft: { ...reply.draft, body: 'Thanks for the update.' } }, { root, run });
  assert.equal(prepared.payload.draft.inReplyTo[0], '<incoming-1@mail.example>');
  assert.equal(prepared.payload.parentMessageId, incomingId);
  assert.equal(prepared.payload.logFollowup, true);
  tracker('Other', 'Other Role');
  await assert.rejects(mail({ action: 'prepare', account: 'primary', messageId: incomingId, draft: reply.draft }, { root, run }), /Application changed/);
  await mail({ action: 'match', messageId: incomingId, appNum: null }, { root });
  const unbound = await mail({ action: 'prepare', account: 'primary', messageId: incomingId, draft: reply.draft }, { root, run });
  assert.equal(unbound.payload.logFollowup, false);
});

test('ambiguous same-company role matches return candidates without binding', async t => {
  const { root, trackerPath } = setup(t);
  fs.writeFileSync(trackerPath, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-10-01 | Acme | Support Engineer | 4/5 | Applied | — | support.md | — |',
    '| 2 | 2026-10-02 | Acme | Backend Engineer | 4/5 | Applied | — | backend.md | — |', '',
  ].join('\n'));
  const run = async req => ({ messages: [msg('ambiguous', 4)], uidValidity: '7', lastUid: '4', hasMore: false });
  await mail({ action: 'sync', account: 'primary', since: '2026-10-01' }, { root, run });
  const result = await mail({ action: 'messages' }, { root });
  assert.equal(result.messages[0].application, null);
  assert.deepEqual(result.messages[0].suggestions.map(s => s.appNum), [1, 2]);
  assert.ok(result.messages[0].suggestions.every(s => s.ambiguous));
});

test('thread associations are dynamic, account-bound, and explicit unmatch blocks stale child links', async t => {
  const { root, trackerPath } = setup(t);
  fs.writeFileSync(trackerPath, [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-10-01 | Acme | Support Engineer | 4/5 | Applied | — | report-1.md | — |',
    '| 2 | 2026-10-02 | Other | Other Role | 4/5 | Applied | — | report-2.md | — |', '',
  ].join('\n'));
  const foreignParent = { ...msg('foreign-parent', 1), message_id: 'foreign-parent', account: 'secondary', rfcMessageId: '<parent@mail.example>', application: { num: 1, company: 'Acme', role: 'Support Engineer', report: 'report-1.md' }, applicationBinding: 'matched' };
  fs.mkdirSync(path.join(root, 'data/mail/messages'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/mail/messages', `${createHash('sha256').update('foreign-parent').digest('hex')}.json`), JSON.stringify(foreignParent));
  const parent = { ...msg('parent', 1), body_snippet: 'An unrelated message' };
  const child = { ...msg('child', 2), inReplyTo: ['<parent@mail.example>'], references: ['<parent@mail.example>'] };
  const sync = await mail({ action: 'sync', account: 'primary', since: '2026-10-01' }, { root, run: async () => ({ messages: [parent, child], uidValidity: '7', lastUid: '2', hasMore: false }) });
  const [parentId, childId] = sync.messages.map(message => message.message_id);
  const filteredUnmatched = await mail({ action: 'messages', appNum: 1 }, { root });
  assert.deepEqual(filteredUnmatched.messages.map(message => message.message_id), ['foreign-parent']);
  assert.equal(filteredUnmatched.applications.length, 2);
  await mail({ action: 'match', messageId: parentId, appNum: 1 }, { root });
  const matched = await mail({ action: 'messages', appNum: 1 }, { root });
  assert.deepEqual(new Set(matched.messages.map(message => message.message_id)), new Set(['foreign-parent', parentId, childId]));

  // Simulate an older cache which persisted an inherited match on the child.
  const childFile = path.join(root, 'data/mail/messages', `${createHash('sha256').update(childId).digest('hex')}.json`);
  const cachedChild = JSON.parse(fs.readFileSync(childFile, 'utf8'));
  cachedChild.application = matched.messages.find(message => message.message_id === parentId).application;
  cachedChild.applicationBinding = 'thread'; fs.writeFileSync(childFile, JSON.stringify(cachedChild));
  await mail({ action: 'match', messageId: parentId, appNum: null }, { root });
  assert.deepEqual((await mail({ action: 'messages', appNum: 1 }, { root })).messages.map(message => message.message_id), ['foreign-parent']);
  const reply = await mail({ action: 'reply', messageId: childId }, { root });
  assert.equal(reply.application, null); assert.equal(reply.association, 'unmatched');
  const prepared = await mail({ action: 'prepare', account: 'primary', messageId: childId, draft: { ...reply.draft, body: 'Thanks' } }, { root, run: async () => ({ wire: 'd2lyZQ==', rfcMessageId: '<sent@mail.example>' }) });
  assert.equal(prepared.payload.application, null); assert.equal(prepared.payload.logFollowup, false);
});

test('accepted sends append exactly one follow-up; reconcile never resends; unknown and partial do not log', async t => {
  const { root } = setup(t); let sends = 0;
  fs.writeFileSync(path.join(root, 'data/follow-ups.md'), '# Follow-ups\n- next #1 2027-01-01 (set 2026-10-10)\n- next #9 2027-01-01 (set 2026-10-10)\n');
  const run = async req => req.action === 'encode' ? { wire: Buffer.from('mime').toString('base64'), rfcMessageId: '<sent@mail.example>' }
    : req.action === 'send' ? (sends++, { status: 'accepted', accepted: req.recipients, refused: [] }) : {};
  const prepared = await mail({ action: 'prepare', account: 'primary', appNum: 1, draft: { to: ['recruiter@acme.example'], cc: ['Me@Example.com', 'observer@acme.example'], bcc: [], subject: 'Following up', body: 'Hello', attachments: [] } }, { root, run });
  const receipt = await mail({ action: 'send', id: prepared.id, confirm: prepared.digest }, { root, run });
  assert.equal(receipt.followupLog.logged, true);
  await mail({ action: 'reconcile', id: prepared.id }, { root, run });
  assert.equal(sends, 1);
  const log = fs.readFileSync(path.join(root, 'data/follow-ups.md'), 'utf8');
  assert.equal((log.match(/\[mail-followup:/g) || []).length, 1);
  assert.match(log, /\| 1 \| 1 \|/);
  assert.doesNotMatch(log, /next #1\b/); assert.match(log, /next #9\b/);
  assert.equal(parseFollowups(log).filter(entry => entry.appNum === 1).length, 1);
  const cadence = analyzeFromContent(fs.readFileSync(path.join(root, 'data/applications.md'), 'utf8'), log).entries.find(app => app.num === 1);
  assert.equal(cadence.followupCount, 1); assert.notEqual(cadence.nextFollowupDate, '2027-01-01');
  const review = await mail({ action: 'review', id: prepared.id }, { root });
  assert.equal(review.receipt.followupLog.logged, true);
  const sentReply = await mail({ action: 'reply', messageId: `sent-${prepared.id}`, replyAll: true }, { root });
  assert.deepEqual(sentReply.draft.to, ['recruiter@acme.example']);
  assert.deepEqual(sentReply.draft.cc, ['observer@acme.example']);
  assert.ok(!sentReply.draft.to.some(address => address.toLowerCase() === 'me@example.com'));

  for (const status of ['unknown', 'partial']) {
    const p = await mail({ action: 'prepare', account: 'primary', appNum: 1, draft: { to: ['recruiter@acme.example'], cc: [], bcc: [], subject: status, body: 'Hello', attachments: [] } }, { root, run });
    const uncertain = await mail({ action: 'send', id: p.id, confirm: p.digest }, { root, run: async req => req.action === 'encode' ? run(req) : (sends++, { status }) });
    assert.equal(uncertain.followupLog, undefined);
  }
  assert.equal((fs.readFileSync(path.join(root, 'data/follow-ups.md'), 'utf8').match(/\[mail-followup:/g) || []).length, 1);
  const incoming = await mail({ action: 'sync', account: 'primary', since: '2026-10-01' }, { root, run: async () => ({ messages: [{ ...msg('followup-reply', 2), inReplyTo: ['<sent@mail.example>'], references: ['<sent@mail.example>'] }], uidValidity: '9', lastUid: '2', hasMore: false }) });
  const threaded = await mail({ action: 'messages' }, { root });
  assert.equal(incoming.messages.length, 1);
  assert.equal(threaded.messages.find(message => message.message_id === incoming.messages[0].message_id).application?.num, 1, JSON.stringify(threaded.messages.map(message => [message.subject, message.rfcMessageId, message.applicationBinding])));
});

test('accepted receipt with failed logging reconciles only the log and honors follow-up override', async t => {
  const { root } = setup(t); let sends = 0;
  const override = path.join(root, 'outside-followups.md'); process.env.CAREER_OPS_FOLLOWUPS = override;
  const run = async req => req.action === 'encode' ? { wire: 'd2lyZQ==', rfcMessageId: '<sent@mail.example>' }
    : req.action === 'send' ? (sends++, { status: 'accepted' }) : {};
  const prepared = await mail({ action: 'prepare', account: 'primary', appNum: 1, draft: { to: ['recruiter@acme.example'], cc: [], bcc: [], subject: 'Following up', body: 'Hello', attachments: [] } }, { root, run });
  // A malformed directory at the override path forces append failure after acceptance.
  fs.mkdirSync(override);
  const accepted = await mail({ action: 'send', id: prepared.id, confirm: prepared.digest }, { root, run });
  assert.equal(accepted.status, 'accepted'); assert.ok(accepted.followupLogError); assert.equal(sends, 1);
  const receiptPath = path.join(root, 'data/mail/outbox', prepared.id + '.json.receipt.json');
  const savedReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); savedReceipt.acceptedAt = '2026-10-20T02:00:00.000Z'; fs.writeFileSync(receiptPath, JSON.stringify(savedReceipt));
  fs.rmdirSync(override);
  const recovered = await mail({ action: 'reconcile', id: prepared.id }, { root, run });
  assert.equal(recovered.followupLog.logged, true); assert.equal(sends, 1);
  assert.equal(parseFollowups(fs.readFileSync(override, 'utf8'))[0].date, localDateOf('2026-10-20T02:00:00.000Z'));
  assert.ok(fs.readFileSync(override, 'utf8').includes('[mail-followup:'));
  assert.equal(fs.existsSync(path.join(root, 'data/follow-ups.md')), false);
});

test('send refuses a stale application snapshot after preparation', async t => {
  const { root, tracker } = setup(t); let sends = 0;
  const run = async req => req.action === 'encode' ? { wire: 'd2lyZQ==', rfcMessageId: '<sent@mail.example>' }
    : req.action === 'send' ? (sends++, { status: 'accepted' }) : {};
  const prepared = await mail({ action: 'prepare', account: 'primary', appNum: 1, draft: { to: ['recruiter@acme.example'], cc: [], bcc: [], subject: 'Following up', body: 'Hello', attachments: [] } }, { root, run });
  tracker('Acme', 'Principal Engineer');
  await assert.rejects(mail({ action: 'send', id: prepared.id, confirm: prepared.digest }, { root, run }), /Application changed/);
  assert.equal(sends, 0);
});

test('accepted follow-up logging waits for the same application identity during recovery', async t => {
  const { root, tracker } = setup(t); let sends = 0;
  const run = async req => {
    if (req.action === 'encode') return { wire: 'd2lyZQ==', rfcMessageId: '<sent@mail.example>' };
    if (req.action === 'send') { sends++; tracker('Different Employer', 'Different Role'); return { status: 'accepted' }; }
    return {};
  };
  const prepared = await mail({ action: 'prepare', account: 'primary', appNum: 1, draft: { to: ['recruiter@acme.example'], cc: [], bcc: [], subject: 'Following up', body: 'Hello', attachments: [] } }, { root, run });
  const receipt = await mail({ action: 'send', id: prepared.id, confirm: prepared.digest }, { root, run });
  assert.equal(receipt.status, 'accepted'); assert.match(receipt.followupLogError, /Application changed/);
  assert.equal(fs.existsSync(path.join(root, 'data/follow-ups.md')), false);
  const retry = await mail({ action: 'reconcile', id: prepared.id }, { root, run });
  assert.match(retry.followupLogError, /Application changed/); assert.equal(sends, 1);
  tracker();
  const recovered = await mail({ action: 'reconcile', id: prepared.id }, { root, run });
  assert.equal(recovered.followupLog.logged, true); assert.equal(sends, 1);
});
