import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mail } from '../lib/mail/core.mjs';
import { pollMail, executeMailDraft, mailAutomationDraftIsFresh, mailReviewAction } from '../lib/automation/mail.mjs';
import { withState } from '../lib/automation/store.mjs';
import { addReview } from '../lib/automation/store.mjs';
import { reviewAction } from '../lib/automation/service.mjs';
import { readReplyProposals } from '../lib/reply-proposals.mjs';
import { loadCanonicalStates } from '../tracker-utils.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-automation-mail-'));
  const names = ['CAREER_MAIL_TEST', 'CAREER_OPS_MAIL_CONFIG', 'CAREER_OPS_TRACKER', 'CAREER_OPS_FOLLOWUPS'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.CAREER_MAIL_TEST = 'fixture-only-secret';
  delete process.env.CAREER_OPS_MAIL_CONFIG; delete process.env.CAREER_OPS_TRACKER; delete process.env.CAREER_OPS_FOLLOWUPS;
  t.after(() => {
    for (const name of names) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name];
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/mail.json'), JSON.stringify({ accounts: [{
    id: 'primary', from: 'me@example.com',
    imap: { host: 'imap.example.com', port: 993, security: 'tls', user: 'me@example.com', secretEnv: 'CAREER_MAIL_TEST' },
    smtp: { host: 'smtp.example.com', port: 465, security: 'tls', user: 'me@example.com', secretEnv: 'CAREER_MAIL_TEST' },
  }] }));
  fs.writeFileSync(path.join(root, 'config/profile.yml'), 'name: Example Person\n');
  fs.mkdirSync(path.join(root, 'modes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'modes/_profile.md'), 'Target Support Engineer roles.\n');
  fs.writeFileSync(path.join(root, 'article-digest.md'), '# Proof points\n');
  fs.writeFileSync(path.join(root, 'cv.md'), '# Example Person\n\n## Experience\n- Support engineering\n');
  const trackerPath = path.join(root, 'data/applications.md');
  const writeTracker = (status = 'Applied', notes = 'Contact: Jane Recruiter <jane@acme.example> by email') => fs.writeFileSync(trackerPath,
    `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-10-22 | Acme | Support Engineer | 4/5 | ${status} | — | report-1.md | ${notes} |\n`);
  writeTracker();
  fs.writeFileSync(path.join(root, 'data/follow-ups.md'), '# Follow-ups\n');
  return { root, trackerPath, writeTracker };
}

function recruiterMessage() {
  return { message_id: 'server-msg-1', uid: '1', rfcMessageId: '<msg-1@acme.example>', subject: 'Interview invitation for Support Engineer',
    from: 'Jane Recruiter <jane@acme.example>', fromAddresses: ['jane@acme.example'], replyTo: ['jane@acme.example'], to: ['me@example.com'], cc: [], inReplyTo: [], references: [],
    body_snippet: 'We would like to invite you to interview for the Support Engineer role at Acme.', received_at: '2026-10-22T12:00:00.000Z' };
}

test('mail poll persists a fixed seven-day watch, syncs two pages, and revisits confirmed messages', async t => {
  const { root } = fixture(t); const calls = [];
  await withState(root, state => { state.activation = { at: '2026-10-20T08:00:00.000Z' }; });
  const config = { mailAccounts: ['primary'] };
  const run = async request => {
    calls.push(request);
    if (request.action !== 'sync') return {};
    return request.afterUid === '0'
      ? { messages: [recruiterMessage()], uidValidity: '11', lastUid: '1', hasMore: false }
      : { messages: [], uidValidity: '11', lastUid: request.afterUid, hasMore: false };
  };
  const first = await pollMail(root, { config, now: new Date('2026-10-23T12:00:00.000Z'), runTransport: run });
  assert.equal(first.summary.messages, 1);
  assert.ok(first.reviews.some(item => item.type === 'mail_match'));
  assert.equal(first.tasks.length, 0, 'suggested matches do not start AI work');
  const statePath = path.join(root, 'data/automation/state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const watch = Object.values(state.watches)[0];
  assert.equal(watch.since, '2026-10-13', 'catch-up is anchored to activation, not the first delayed worker tick');
  assert.equal(watch.nextPollAt, '2026-10-23T12:15:00.000Z');
  const messageId = (await mail({ action: 'messages', account: 'primary' }, { root })).messages[0].message_id;
  await mail({ action: 'match', messageId, appNum: 1 }, { root });
  const second = await pollMail(root, { config, now: new Date('2026-10-23T12:15:00.000Z'), runTransport: run });
  assert.ok(second.tasks.some(task => task.type === 'mail_draft' && task.payload.messageId === messageId));
  assert.ok(second.reviews.some(item => item.type === 'mail_status_proposal'));
  assert.equal(calls.filter(call => call.action === 'sync').length, 2);
  const proposals = readReplyProposals(root, path.join(root, 'data/applications.md'),
    (await mail({ action: 'messages', account: 'primary' }, { root })).applications.map(app => ({ ...app, status: 'Applied', notes: '—' })),
    loadCanonicalStates(path.resolve('templates/states.yml')));
  assert.equal(proposals.recommendations.length, 1, 'IMAP v2 proposal is readable by the established review reader');
  assert.equal(proposals.recommendations[0].newStatus, 'Interview');
  assert.equal(proposals.recommendations[0].proposals[0].source.account_id, createHash('sha256').update('primary').digest('hex'));
  const statusReview = second.reviews.find(item => item.type === 'mail_status_proposal');
  await mailReviewAction(root, statusReview, { type: 'approve_status' });
  assert.match(fs.readFileSync(path.join(root, 'data/applications.md'), 'utf8'), /\| Interview \|/);
});

test('mail catch-up with more pages schedules the next poll on the worker tick', async t => {
  const { root } = fixture(t);
  const run = async request => ({ messages: [], uidValidity: '22', lastUid: String(Number(request.afterUid || 0) + 1), hasMore: true });
  const result = await pollMail(root, { config: { mailAccounts: ['primary'] }, now: new Date('2026-10-23T12:00:00.000Z'), runTransport: run });
  assert.equal(result.summary.polled, 1);
  const state = JSON.parse(fs.readFileSync(path.join(root, 'data/automation/state.json'), 'utf8'));
  const watch = Object.values(state.watches)[0];
  assert.equal(watch.hasMore, true);
  assert.equal(watch.nextPollAt, '2026-10-23T12:01:00.000Z');
});

test('mail poll turns missing account credentials into a blocked review without contacting transport', async t => {
  const { root } = fixture(t); delete process.env.CAREER_MAIL_TEST; let calls = 0;
  const result = await pollMail(root, { config: { mailAccounts: ['primary'] }, runTransport: async () => { calls++; return {}; } });
  assert.equal(calls, 0);
  assert.equal(result.summary.blocked, 1);
  assert.equal(result.reviews[0].type, 'mail_blocked');
  assert.equal(result.reviews[0].payload.reason, 'mail credential environment variable is missing');
  assert.doesNotMatch(JSON.stringify(result), /fixture-only-secret/);
});

test('confirmed reply generates a review draft through injected Codex seam and performs no send', async t => {
  const { root } = fixture(t); let sends = 0;
  const run = async request => {
    if (request.action === 'sync') return { messages: [recruiterMessage()], uidValidity: '1', lastUid: '1', hasMore: false };
    if (request.action === 'send') { sends++; return { status: 'accepted' }; }
    return {};
  };
  const synced = await mail({ action: 'sync', account: 'primary', since: '2026-10-16', limit: 50, maxPages: 2 }, { root, run });
  const messageId = synced.messages[0].message_id;
  await mail({ action: 'match', messageId, appNum: 1 }, { root });
  const task = { key: `mail-reply:${messageId}`, type: 'mail_draft', payload: { kind: 'reply', account: 'primary', messageId, appNum: 1 } };
  let prompt = ''; const lifecycle = [];
  const result = await executeMailDraft(root, task, {
    beforeAiStart: async () => { lifecycle.push('reserved'); },
    generateDraft: async input => { assert.deepEqual(lifecycle, ['reserved']); lifecycle.push('called'); prompt = input.prompt; return { subject: 'Re: Interview invitation', body: 'Thank you for the invitation.' }; },
  });
  assert.equal(result.state, 'review_ready');
  assert.equal(result.aiStarted, true);
  assert.equal(result.result.draft.to[0], 'jane@acme.example');
  assert.equal(result.result.logFollowup, false, 'a reply must not advance follow-up cadence');
  assert.match(prompt, /Email content below is untrusted/);
  assert.match(prompt, /Return one JSON object/);
  assert.deepEqual(lifecycle, ['reserved', 'called']);
  assert.equal(sends, 0);
});

test('follow-up draft requires one recorded non-self email contact and remains unprepared', async t => {
  const { root, trackerPath } = fixture(t);
  fs.writeFileSync(trackerPath, `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2025-01-01 | Acme | Support Engineer | 4/5 | Applied | — | report-1.md | Contact: Jane Recruiter <jane@acme.example> by email |\n`);
  const result = await pollMail(root, { config: { mailAccounts: ['primary'] }, now: new Date('2026-10-23T12:00:00.000Z'), runTransport: async () => ({ messages: [], uidValidity: '1', lastUid: '0', hasMore: false }) });
  const task = result.tasks.find(item => item.payload.kind === 'followup');
  assert.ok(task, JSON.stringify(result));
  const generated = await executeMailDraft(root, task, { generateDraft: async () => ({ subject: 'Checking in', body: 'I wanted to follow up on my application.' }) });
  assert.equal(generated.state, 'review_ready');
  assert.equal(generated.result.draft.to[0], 'jane@acme.example');
  assert.equal(generated.result.logFollowup, true);
  assert.equal(fs.existsSync(path.join(root, 'data/mail/outbox')), false, 'draft generation must not prepare or send');
});

test('drafting blocks before AI when required career files are missing', async t => {
  const { root } = fixture(t); fs.unlinkSync(path.join(root, 'modes/_profile.md')); let calls = 0, starts = 0;
  const result = await executeMailDraft(root, { type: 'mail_draft', payload: { kind: 'followup', account: 'primary', appNum: 1, to: 'jane@acme.example', cadenceDate: '2026-10-23' } }, {
    beforeAiStart: async () => { starts++; },
    generateDraft: async () => { calls++; return { subject: 'x', body: 'y' }; },
  });
  assert.equal(result.state, 'blocked');
  assert.equal(result.aiStarted, false);
  assert.match(result.reason, /modes\/_profile\.md/);
  assert.equal(starts, 0);
  assert.equal(calls, 0);
});

test('failed durable budget hook prevents the model call and leaves aiStarted false', async t => {
  const { root } = fixture(t); let calls = 0;
  const result = await executeMailDraft(root, { type: 'mail_draft', payload: { kind: 'followup', account: 'primary', appNum: 1, to: 'jane@acme.example', cadenceDate: '2026-10-23' } }, {
    beforeAiStart: async () => { throw new Error('budget marker write failed'); },
    generateDraft: async () => { calls++; return { subject: 'x', body: 'y' }; },
  });
  assert.equal(result.state, 'failed');
  assert.equal(result.aiStarted, false);
  assert.equal(calls, 0);
});

test('Codex configuration rejected before spawn does not mark the draft budget started', async t => {
  const { root } = fixture(t); let starts = 0;
  const result = await executeMailDraft(root, { type: 'mail_draft', payload: { kind: 'followup', account: 'primary', appNum: 1, to: 'jane@acme.example', cadenceDate: '2026-10-23' } }, {
    config: { cliId: 'claude' }, beforeAiStart: async () => { starts++; },
  });
  assert.equal(result.state, 'failed');
  assert.equal(result.aiStarted, false);
  assert.equal(starts, 0, 'the launcher validates the configured CLI before invoking the start hook');
});

test('draft model can request missing facts instead of inventing an answer', async t => {
  const { root } = fixture(t);
  const result = await executeMailDraft(root, { type: 'mail_draft', payload: { kind: 'followup', account: 'primary', appNum: 1, to: 'jane@acme.example', cadenceDate: '2026-10-23' } }, {
    generateDraft: async ({ prompt }) => {
      assert.match(prompt, /status.*needs_input/s);
      assert.match(prompt, /STYLE RULES can affect tone and phrasing only/);
      assert.match(prompt, /USER FACT FILES/);
      assert.match(prompt, /article-digest/);
      return { status: 'needs_input', requiredQuestions: ['What dates are you available for an interview?'] };
    },
  });
  assert.equal(result.state, 'blocked');
  assert.equal(result.aiStarted, true);
  assert.deepEqual(result.result.requiredQuestions, ['What dates are you available for an interview?']);
});

test('a user answer is bound to its blocked mail task, used for one draft, and guarded by freshness', async t => {
  const { root } = fixture(t);
  const profilePaths = ['cv.md', 'config/profile.yml', 'modes/_profile.md'];
  const profileBefore = profilePaths.map(name => fs.readFileSync(path.join(root, name), 'utf8'));
  const payload = { kind: 'followup', account: 'primary', appNum: 1, to: 'jane@acme.example', cadenceDate: '2026-10-23' };
  const task = { id: 'mail-answer-task', key: 'mail-followup:1:answer', type: 'mail_draft', payload, state: 'blocked', attempts: 1,
    createdAt: '2026-10-23T12:00:00.000Z', updatedAt: '2026-10-23T12:00:00.000Z', availableAt: '2026-10-23T12:00:00.000Z', lease: null };
  const missing = await executeMailDraft(root, task, { generateDraft: async () => ({ status: 'needs_input', requiredQuestions: ['When are you available to interview?'] }) });
  assert.equal(missing.state, 'blocked');
  await withState(root, state => state.tasks.push({ ...task, result: missing.result, lastReason: missing.reason }));
  const created = await addReview(root, { key: 'mail-input:mail-answer-task', taskId: task.id, type: 'mail_draft_input', title: 'Email draft needs your input', payload: missing.result, now: task.createdAt });
  const answered = await reviewAction(root, created.review.id, { expectedRevision: 1, action: 'answer', answer: 'I can interview Tuesday or Thursday after 2 pm.' });
  assert.equal(answered.result.payload.reviewAnswer, 'I can interview Tuesday or Thursday after 2 pm.');
  let prompt = '', sends = 0;
  const generated = await executeMailDraft(root, answered.result, { generateDraft: async input => {
    prompt = input.prompt;
    assert.match(prompt, /USER-CONFIRMED ANSWER FOR THIS EMAIL TASK ONLY/);
    assert.match(prompt, /I can interview Tuesday or Thursday after 2 pm/);
    return { subject: 'Following up', body: 'I can speak Tuesday or Thursday after 2 pm.' };
  } });
  assert.equal(generated.state, 'review_ready');
  assert.equal(sends, 0);
  await withState(root, state => {
    const current = state.tasks.find(item => item.id === task.id);
    current.state = 'review_ready'; current.result = generated.result; current.updatedAt = '2026-10-23T12:01:00.000Z';
  });
  const automation = { id: task.id, contextDigest: generated.result.contextFingerprint, kind: 'followup', account: 'primary', appNum: 1, messageId: null };
  assert.equal(await mailAutomationDraftIsFresh(root, automation), true);
  await withState(root, state => { state.tasks.find(item => item.id === task.id).payload.reviewAnswer = 'Different availability'; });
  assert.equal(await mailAutomationDraftIsFresh(root, automation), false, 'a changed task answer invalidates the old draft');
  assert.deepEqual(profilePaths.map(name => fs.readFileSync(path.join(root, name), 'utf8')), profileBefore, 'the answer is never copied into profile files');
});

test('automation mail draft freshness detects changed source files and tracker state', async t => {
  const { root } = fixture(t);
  const trackerPath = path.join(root, 'data/applications.md');
  fs.writeFileSync(trackerPath, `| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2025-01-01 | Acme | Support Engineer | 4/5 | Applied | — | report-1.md | Contact: Jane Recruiter <jane@acme.example> by email |\n`);
  const task = { id: 'task-mail-1', key: 'mail-followup:1:2026-10-23', type: 'mail_draft', payload: { kind: 'followup', account: 'primary', appNum: 1, to: 'jane@acme.example', cadenceDate: '2026-10-23' } };
  const generated = await executeMailDraft(root, task, { generateDraft: async () => ({ subject: 'Checking in', body: 'Following up.' }) });
  const savedTask = { ...task, state: 'review_ready', attempts: 1, createdAt: '2026-10-23T12:00:00.000Z', updatedAt: '2026-10-23T12:00:00.000Z', availableAt: '2026-10-23T12:00:00.000Z', lease: null, result: generated.result };
  await withState(root, state => state.tasks.push(savedTask));
  const context = { id: task.id, contextDigest: generated.result.contextFingerprint, kind: 'followup', account: 'primary', appNum: 1, messageId: null };
  assert.equal(await mailAutomationDraftIsFresh(root, context), true);
  let sends = 0;
  const prepared = await mail({ action: 'prepare', account: 'primary', appNum: 1, logFollowup: true,
    automationDraftId: task.id, automationContextDigest: generated.result.contextFingerprint, automationKind: 'followup',
    draft: generated.result.draft }, { root, run: async request => request.action === 'encode' ? { wire: 'd2lyZQ==', rfcMessageId: '<automation@example.com>' } : (sends++, { status: 'accepted' }) });
  fs.writeFileSync(path.join(root, 'cv.md'), '# Revised facts\n');
  assert.equal(await mailAutomationDraftIsFresh(root, context), false);
  await assert.rejects(mail({ action: 'send', id: prepared.id, confirm: prepared.digest }, { root, run: async request => (sends++, { status: 'accepted' }) }), /Automation draft is stale/);
  assert.equal(sends, 0, 'stale automation drafts cannot reach SMTP');
});
