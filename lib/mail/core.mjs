import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { withPipelineLock } from '../../pipeline-lock.mjs';
import { writeFileAtomic } from '../../tracker-utils.mjs';
import { resolveTrackerPath, canonicalizeTrackerPath } from '../../path-resolver.mjs';
import { resolveColumns, parseTrackerRow } from '../../tracker-parse.mjs';
import { matchCandidates, checkRoleMatchExact, classifyReply } from '../../reply-matcher.mjs';
import { withFollowupsLock } from '../../followup-seed.mjs';
import { localToday } from '../local-today.mjs';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = message => { throw new Error(message); };
export function transport(request) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [fileURLToPath(new URL('./transport.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Mail transport timed out')); }, 120000);
    child.stdout.on('data', chunk => { out += chunk; if (out.length > 20_000_000) child.kill(); });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('Could not start python3 mail transport')); });
    child.on('close', code => { clearTimeout(timer); try { const result = JSON.parse(out); if (code || result.error) reject(new Error(result.error || 'Mail transport failed')); else resolve(result); } catch { reject(new Error('Mail transport returned no result')); } });
    child.stdin.end(JSON.stringify(request));
  });
}
export function readMailAccounts(root = getCareerOpsRoot()) {
  const filename = process.env.CAREER_OPS_MAIL_CONFIG || path.join(root, 'config/mail.json');
  if (!fs.existsSync(filename)) return [];
  let data; try { data = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { fail('Cannot parse mail.json; fix it before continuing'); }
  if (!Array.isArray(data.accounts)) fail('mail.json must contain an accounts array');
  const ids = new Set();
  for (const a of data.accounts) {
    if (!a || typeof a.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(a.id) || ids.has(a.id)) fail('Invalid or duplicate mail account id'); ids.add(a.id);
    address(a.from);
    for (const key of ['imap', 'smtp']) if (a[key]) {
      const c = a[key];
      if (!['tls', 'starttls'].includes(c.security) || typeof c.host !== 'string' || !c.host || typeof c.user !== 'string' || !c.user || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535 || typeof c.secretEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.secretEnv) || !['password', 'oauth2'].includes(c.auth || 'password')) fail('Invalid mail transport configuration');
      if ('password' in c || 'token' in c) fail('Use secretEnv instead of credentials in mail.json');
    }
  }
  return data.accounts;
}
const accounts = readMailAccounts;
function address(s) { if (typeof s !== 'string' || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(s)) fail('Use plain email addresses without display names'); return s; }
function save(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); writeFileAtomic(file, JSON.stringify(data, null, 2), { mode: 0o600 }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
function readJsonText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } }
function tracker(root) {
  const filename = resolveTrackerPath(root);
  if (!fs.existsSync(filename)) return { filename, apps: [], content: '' };
  const content = fs.readFileSync(filename, 'utf8'), lines = content.split('\n'), columns = resolveColumns(lines);
  return { filename, content, apps: lines.map(line => parseTrackerRow(line, columns)).filter(Boolean) };
}
export function readMailTracker(root = getCareerOpsRoot()) { return tracker(root); }
function appIdentity(app) { return app && ({ num: app.num, company: app.company, role: app.role, report: app.report || '' }); }
function sameApp(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function messageFiles(root) { return path.join(root, 'data/mail/messages'); }
function followupsPath(root) { return process.env.CAREER_OPS_FOLLOWUPS || path.join(root, 'data/follow-ups.md'); }
function messagePath(root, id) { if (!/^[A-Za-z0-9_-]{1,256}$/.test(id || '')) fail('Invalid message id'); return path.join(messageFiles(root), `${createHash('sha256').update(id).digest('hex')}.json`); }
function getMessage(root, id) { const m = readJson(messagePath(root, id), null); if (!m || m.message_id !== id) fail('Mail message not found'); return m; }
export function readCachedMailMessage(root, id) { return getMessage(root, id); }
function allMessages(root, account) {
  const dir = messageFiles(root); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => readJson(path.join(dir, n), null)).filter(m => m && (!account || m.account === account));
}
function cursorKey(account, mailbox) { return createHash('sha256').update(`${account.id}\0${account.imap.host}\0${account.imap.port}\0${account.imap.user}\0${mailbox}`).digest('hex'); }
function followupReceipt(id) { return `[mail-followup:${id}]`; }
function localDate(timestamp) { const d = new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function findThreadParent(root, message) {
  if (typeof message.account !== 'string' || !message.account) return null;
  const candidates = allMessages(root, message.account).filter(candidate => candidate.message_id !== message.message_id);
  const ids = [...(message.inReplyTo || []), ...[...(message.references || [])].reverse()];
  for (const id of ids) {
    const matches = candidates.filter(candidate => candidate.rfcMessageId === id);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
  }
  return null;
}
function effectiveAssociation(root, message, visited = new Set()) {
  if (visited.has(message.message_id)) return { application: null, binding: 'unmatched' };
  visited.add(message.message_id);
  if (message.applicationBinding === 'unbound') return { application: null, binding: 'unbound' };
  if (message.applicationBinding === 'matched' && message.application) return { application: message.application, binding: 'matched' };
  // `thread` bindings from existing caches are derived hints, never frozen matches.
  const parent = findThreadParent(root, message);
  if (!parent) return { application: null, binding: 'unmatched' };
  const inherited = effectiveAssociation(root, parent, visited);
  return inherited.application ? { application: inherited.application, binding: 'thread' } : inherited;
}
function suggestionsFor(message, apps, followups) {
  const result = matchCandidates([message], apps, followups)[0];
  if (result?.application_num) return [{ appNum: result.application_num, company: result.company_hint, role: result.role_hint, confidence: result.confidence }];
  if (result?.application_nums?.length) return result.application_nums.map(appNum => {
    const app = apps.find(candidate => candidate.num === appNum);
    return { appNum, company: app?.company, role: app?.role, confidence: result.confidence, ambiguous: true };
  });
  if (!result?.signals?.includes('ambiguous-match')) return [];
  const context = `${message.from || ''} ${message.subject || ''} ${message.body_snippet || ''}`;
  const confidenceRank = { high: 3, medium: 2, low: 1 };
  return apps.flatMap(app => {
    const candidate = matchCandidates([message], [app], followups)[0];
    if (!candidate?.application_num) return [];
    return [{ appNum: app.num, company: app.company, role: app.role, confidence: candidate.confidence, ambiguous: true,
      exactRole: checkRoleMatchExact(context, app.role) }];
  }).sort((a, b) => Number(b.exactRole) - Number(a.exactRole) || confidenceRank[b.confidence] - confidenceRank[a.confidence]);
}
async function appendFollowup(root, prepared, id, sentAt) {
  if (!prepared.payload.logFollowup || !prepared.payload.application) return { logged: false, reason: 'disabled' };
  const file = followupsPath(root), receipt = followupReceipt(id);
  return withFollowupsLock(file, () => {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Follow-ups\n';
    const { appNum, company, role } = prepared.payload.application;
    if (text.includes(receipt)) return { logged: true, duplicate: true };
    verifyPreparedApplication(root, prepared);
    const rows = (text.match(/^\|\s*\d+\s*\|/gm) || []).map(x => Number(x.match(/^\|\s*(\d+)/)[1]));
    const num = rows.length ? Math.max(...rows) + 1 : 1;
    const cell = value => String(value || '').replace(/[|\r\n]/g, ' ').trim();
    const eventDate = sentAt ? localDate(sentAt) : localToday();
    const line = `| ${num} | ${appNum} | ${eventDate} | ${cell(company).slice(0, 80)} | ${cell(role).slice(0, 80)} | Email | ${cell(prepared.payload.draft.to.join(', ')).slice(0, 120)} | Sent email ${receipt} |`;
    const suffix = text.endsWith('\n') ? '' : '\n';
    const hasHeader = text.split('\n').some(row => /^\|\s*(num|#)\s*\|/i.test(row));
    const tableHeader = hasHeader ? '' : '| num | appNum | date | company | role | channel | contact | notes |\n|---|---|---|---|---|---|---|---|\n';
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const clearedPins = text.split('\n').filter(row => !new RegExp(`^\\s*-\\s*next\\s+#${appNum}(?:\\s|$)`, 'i').test(row)).join('\n');
    const cleanedSuffix = clearedPins.endsWith('\n') ? '' : '\n';
    writeFileAtomic(file, `${clearedPins}${cleanedSuffix}${tableHeader}${line}\n`, { mode: 0o600 });
    return { logged: true, num };
  });
}
function recordSentThread(root, prepared, receipt) {
  if (!receipt.rfcMessageId) return;
  const message = {
    message_id: `sent-${prepared.id}`, account: prepared.payload.account, mailbox: 'Sent', sent: true, direction: 'sent',
    rfcMessageId: receipt.rfcMessageId, inReplyTo: prepared.payload.draft.inReplyTo || [], references: prepared.payload.draft.references || [],
    from: prepared.payload.draft.from, fromAddresses: [prepared.payload.draft.from], to: prepared.payload.draft.to, cc: prepared.payload.draft.cc,
    subject: prepared.payload.draft.subject, body_snippet: prepared.payload.draft.body.slice(0, 20000),
    received_at: receipt.acceptedAt || receipt.attemptedAt, date: receipt.acceptedAt || receipt.attemptedAt,
    attachments: (prepared.payload.draft.attachments || []).map(a => a.name), truncated: prepared.payload.draft.body.length > 20000,
    application: prepared.payload.application,
    applicationBinding: prepared.payload.application ? 'matched' : 'unbound',
  };
  const file = messagePath(root, message.message_id);
  if (!fs.existsSync(file)) save(file, message);
}
function verifyPreparedApplication(root, saved) {
  const binding = saved.payload.application;
  if (!binding) return;
  if (binding.trackerPath !== canonicalizeTrackerPath(resolveTrackerPath(root))) fail('Tracker path changed since preparation; prepare and review again');
  const current = tracker(root).apps.find(a => a.num === binding.appNum);
  if (!sameApp(appIdentity(current), { num: binding.appNum, company: binding.company, role: binding.role, report: binding.report || '' })) fail('Application changed since preparation; prepare and review again');
}
export async function mail(request, { root = getCareerOpsRoot(), run = transport } = {}) {
  const list = ['accounts', 'fetch', 'sync', 'messages', 'match', 'reply', 'prepare', 'review', 'send', 'reconcile', 'history'].includes(request.action) ? accounts(root) : [];
  if (request.action === 'accounts') return { accounts: list.map(a => ({ id: a.id, from: a.from, imap: !!a.imap, smtp: !!a.smtp, ready: ['imap', 'smtp'].filter(k => a[k] && !!process.env[a[k].secretEnv]) })) };
  const outbox = path.join(root, 'data/mail/outbox');
  const locate = id => { if (!/^[a-f0-9-]{36}$/.test(id || '')) fail('Invalid mail id'); return path.join(outbox, id + '.json'); };
  if (request.action === 'sync') {
    const account = list.find(a => a.id === request.account);
    if (!account?.imap) fail('IMAP is not configured');
    if (!process.env[account.imap.secretEnv]) fail('IMAP credential environment variable is missing');
    const mailbox = request.mailbox || 'INBOX';
    if (typeof mailbox !== 'string' || /[\r\n\x00]/.test(mailbox) || mailbox.length > 200) fail('Invalid mailbox');
    const limit = request.limit ?? 50, maxPages = request.maxPages ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) fail('Invalid sync limit or maxPages');
    const dir = path.join(root, 'data/mail/cursors'), cursorPath = path.join(dir, `${cursorKey(account, mailbox)}.json`);
    return withPipelineLock(cursorPath, async () => {
      let cursor = readJson(cursorPath, { uidValidity: null, lastUid: '0' });
      const since = request.since || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(Date.parse(since)) || new Date(since).toISOString().slice(0, 10) !== since) fail('since must be YYYY-MM-DD');
      if (cursor.since !== since) cursor = { uidValidity: cursor.uidValidity, lastUid: '0', since };
      const imapSince = new Date(since).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replaceAll(' ', '-');
      const found = []; let hasMore = false, skippedOversize = 0, pages = 0;
      while (pages < maxPages) {
        const priorUid = cursor.lastUid || '0';
        const result = await run({ action: 'sync', config: account.imap, mailbox, since: imapSince, limit, afterUid: cursor.lastUid || '0', uidValidity: cursor.uidValidity });
        pages++;
        if (result.reset) cursor = { uidValidity: result.uidValidity, lastUid: '0' };
        for (const raw of result.messages || []) {
          const providerId = raw.message_id;
          if (!providerId) fail('Transport returned a message without a stable id');
          const localId = `imap-${createHash('sha256').update(`${account.id}\0${providerId}`).digest('hex')}`;
          const msg = { ...raw, transportMessageId: providerId, message_id: localId, date: raw.received_at || raw.date || null, account: account.id, mailbox, application: null, suggestions: [], classification: classifyReply(raw) };
          const filename = messagePath(root, msg.message_id), prior = readJson(filename, null);
          if (!prior) {
            save(filename, msg); found.push(msg);
          }
          else found.push(prior);
        }
        skippedOversize += result.skippedOversize || 0;
        // Message records are durable before the cursor advances, so a crash can only repeat a page.
        cursor = { uidValidity: result.uidValidity, lastUid: result.lastUid ?? cursor.lastUid ?? '0', since };
        save(cursorPath, cursor);
        hasMore = !!result.hasMore;
        if (!hasMore || String(cursor.lastUid || '0') === String(priorUid)) break;
      }
      return { account: account.id, mailbox, messages: found, hasMore, pages, skippedOversize };
    });
  }
  if (request.action === 'messages') {
    const rows = tracker(root), all = allMessages(root, request.account);
    // Keep the full application catalog available to clients even when their
    // message list is narrowed to one application.
    const apps = rows.apps;
    const followups = (await import('../../followup-cadence.mjs')).parseFollowups(readJsonText(followupsPath(root)));
    const enriched = all.map(message => {
      const association = effectiveAssociation(root, message);
      message.application = association.application;
      message.applicationBinding = association.binding;
      message.suggestions = suggestionsFor(message, rows.apps, followups);
      message.classification = classifyReply(message);
      return message;
    }).filter(message => !request.appNum || message.application?.num === request.appNum);
    return { messages: enriched, applications: apps.map(a => ({ num: a.num, date: a.date, company: a.company, role: a.role, status: a.status, report: a.report })) };
  }
  if (request.action === 'match') {
    const filename = messagePath(root, request.messageId), message = getMessage(root, request.messageId), rows = tracker(root);
    let app = null;
    if (request.appNum != null) {
      app = rows.apps.find(a => a.num === request.appNum);
      if (!app) fail('Application not found');
    }
    message.application = app ? { ...appIdentity(app), trackerPath: canonicalizeTrackerPath(rows.filename) } : null;
    message.applicationBinding = app ? 'matched' : 'unbound';
    save(filename, message); return { messageId: message.message_id, application: appIdentity(app) };
  }
  if (request.action === 'reply') {
    const message = getMessage(root, request.messageId), association = effectiveAssociation(root, message), app = association.application;
    const self = new Set(list.map(a => a.from.toLowerCase()));
    const froms = message.sent
      ? (message.to || []).filter(address => !self.has(address.toLowerCase()))
      : message.replyTo?.length ? message.replyTo : (message.fromAddresses || []);
    if (!froms.length) fail('Message has no reply address');
    const to = [...new Set(froms)];
    const toSet = new Set(to.map(x => x.toLowerCase()));
    const cc = request.replyAll ? [...new Set([...(message.to || []), ...(message.cc || [])].filter(x => !toSet.has(x.toLowerCase()) && !self.has(x.toLowerCase())))] : [];
    const followups = (await import('../../followup-cadence.mjs')).parseFollowups(readJsonText(followupsPath(root)));
    const suggestions = suggestionsFor(message, tracker(root).apps, followups);
    return { account: message.account, messageId: message.message_id, application: app, association: app ? (association.binding === 'matched' ? 'confirmed-match' : 'confirmed-thread') : 'unmatched', suggestions, draft: { to, cc, bcc: [], subject: /^\s*re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`, body: '', attachments: [] } };
  }
  if (request.action === 'history') {
    if (!fs.existsSync(outbox)) return { drafts: [] };
    const files = fs.readdirSync(outbox).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
      .map(name => ({ name, modified: fs.statSync(path.join(outbox, name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified);
    const drafts = [];
    for (const { name } of files) {
      const file = path.join(outbox, name);
      const row = await withPipelineLock(file, async () => {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (saved.kind === 'inbox') return null;
        const receiptPath = file + '.receipt.json';
        let receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
        if (digest(saved.payload) !== saved.digest) return { id: saved.id, subject: saved.payload.draft?.subject || '', from: saved.payload.draft?.from || '', status: 'invalid', receipt, followup: { error: 'Prepared mail changed; review again' } };
        if (receipt?.status === 'accepted' && saved.payload.logFollowup && !receipt.followupLog) {
          try { receipt.followupLog = await appendFollowup(root, saved, saved.id, receipt.acceptedAt || receipt.attemptedAt); delete receipt.followupLogError; save(receiptPath, receipt); }
          catch (e) { receipt.followupLogError = e.message; save(receiptPath, receipt); }
        }
        if (receipt?.status === 'accepted') { try { recordSentThread(root, saved, receipt); } catch { /* receipt remains authoritative */ } }
        return { id: saved.id, subject: saved.payload.draft.subject, from: saved.payload.draft.from, status: receipt?.status || 'prepared', receipt, followup: receipt?.followupLog || (receipt?.followupLogError ? { error: receipt.followupLogError } : null) };
      });
      if (row) drafts.push(row);
      if (drafts.length === 50) break;
    }
    return { drafts };
  }
  if (['review', 'send'].includes(request.action)) {
    const file = locate(request.id);
    return withPipelineLock(file, async () => {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (digest(saved.payload) !== saved.digest) fail('Prepared mail changed; prepare and review again');
      const receiptPath = file + '.receipt.json';
      if (request.action === 'review') {
        const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
        if (receipt?.status === 'accepted' && saved.payload.logFollowup && !receipt.followupLog) {
          try { receipt.followupLog = await appendFollowup(root, saved, request.id, receipt.acceptedAt || receipt.attemptedAt); delete receipt.followupLogError; save(receiptPath, receipt); }
          catch (e) { receipt.followupLogError = e.message; save(receiptPath, receipt); }
        }
        if (receipt?.status === 'accepted') { try { recordSentThread(root, saved, receipt); } catch { /* receipt remains authoritative */ } }
        return { ...saved, receipt };
      }
      if (request.confirm !== saved.digest) fail('Send requires the reviewed digest');
      if (fs.existsSync(receiptPath)) fail('A send was already attempted; inspect its receipt. Automatic replay is disabled');
      if (saved.payload.automation) {
        const { mailAutomationDraftIsFresh } = await import('../automation/mail.mjs');
        if (!await mailAutomationDraftIsFresh(root, saved.payload.automation)) fail('Automation draft is stale; review the current message and application before preparing again');
      }
      verifyPreparedApplication(root, saved);
      const account = list.find(a => a.id === saved.payload.account);
      if (!account?.smtp || account.from !== saved.payload.draft.from || digest(account.smtp) !== saved.payload.transportDigest) fail('SMTP configuration changed; prepare and review again');
      if (!process.env[account.smtp.secretEnv]) fail('SMTP credential environment variable is missing');
      const receipt = { id: request.id, attemptedAt: new Date().toISOString(), status: 'unknown' };
      save(receiptPath, receipt);
      try {
        Object.assign(receipt, await run({ action: 'send', config: account.smtp, wire: saved.payload.wire, sender: account.from, recipients: [...new Set(['to', 'cc', 'bcc'].flatMap(k => saved.payload.draft[k]))] }));
      } catch (e) { receipt.error = e.message; }
      if (receipt.status === 'accepted') receipt.acceptedAt ||= new Date().toISOString();
      receipt.rfcMessageId ||= saved.payload.rfcMessageId || null;
      save(receiptPath, receipt);
      if (receipt.status === 'accepted') { try { recordSentThread(root, saved, receipt); } catch { /* preserve accepted receipt for review recovery */ } }
      if (receipt.status === 'accepted' && saved.payload.logFollowup) {
        try {
          receipt.followupLog = await appendFollowup(root, saved, request.id, receipt.acceptedAt || receipt.attemptedAt);
        } catch (e) { receipt.followupLogError = e.message; }
        save(receiptPath, receipt);
      }
      return receipt;
    });
  }
  if (request.action === 'reconcile') {
    const file = locate(request.id), receiptPath = file + '.receipt.json';
    return withPipelineLock(file, async () => {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (digest(saved.payload) !== saved.digest) fail('Prepared mail changed; prepare and review again');
      if (!fs.existsSync(receiptPath)) fail('No send receipt exists');
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      if (receipt.status !== 'accepted') fail('Only accepted sends can be reconciled');
      if (!saved.payload.logFollowup) return receipt;
      // The receipt marker in follow-ups makes this safe if the process died after append but before receipt update.
      try {
        receipt.followupLog = await appendFollowup(root, saved, request.id, receipt.acceptedAt || receipt.attemptedAt);
        delete receipt.followupLogError;
      } catch (e) { receipt.followupLogError = e.message; }
      save(receiptPath, receipt); return receipt;
    });
  }
  if (request.action === 'lead') {
    const batch = JSON.parse(fs.readFileSync(locate(request.id), 'utf8'));
    const message = batch.kind === 'inbox' && batch.messages.find(m => m.message_id === request.messageId);
    if (!message?.links?.includes(request.url) || (!/^https?:\/\//.test(request.url) || /[\s\x00]/.test(request.url))) fail('Select a source link from this inbox batch');
    const { appendToPipeline, appendToScanHistory } = await import('../../scan.mjs');
    const { localToday } = await import('../local-today.mjs');
    const offers = [{ url: request.url, company: '', title: message.subject.replace(/[\r\n\t|]/g, ' '), location: '', source: 'imap' }];
    await appendToPipeline(offers); await appendToScanHistory(offers, localToday(), 'added');
    return { added: 1 };
  }
  if (request.action === 'import') {
    const file = locate(request.id); const batch = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (batch.kind !== 'inbox') fail('Not an inbox batch');
    if (!Array.isArray(request.ids) || request.ids.some(id => !batch.messages.some(m => m.message_id === id))) fail('Select messages from this inbox batch');
    const target = process.env.CAREER_OPS_REPLY_CANDIDATES || path.join(root, 'data/reply-candidates.json');
    return withPipelineLock(target, () => {
      const existing = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : [];
      if (!Array.isArray(existing)) fail('Reply candidates must be an array');
      const ids = new Set(existing.map(m => m.message_id));
      const added = batch.messages.filter(m => request.ids.includes(m.message_id) && !ids.has(m.message_id));
      save(target, [...existing, ...added]); return { added: added.length };
    });
  }
  const account = list.find(a => a.id === request.account);
  if (!account) fail('Select a configured mail account');
  if (request.action === 'fetch') {
    if (!account.imap) fail('IMAP is not configured');
    if (!process.env[account.imap.secretEnv]) fail('IMAP credential environment variable is missing');
    const limit = request.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('limit must be 1–50');
    const date = request.since || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('since must be YYYY-MM-DD');
    const mailbox = request.mailbox || 'INBOX';
    if (typeof mailbox !== 'string' || /[\r\n\x00]/.test(mailbox) || mailbox.length > 200) fail('Invalid mailbox');
    const since = new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replaceAll(' ', '-');
    const result = await run({ action: 'fetch', config: account.imap, mailbox, since, limit });
    const id = randomUUID(); save(locate(id), { kind: 'inbox', ...result }); return { id, ...result };
  }
  if (request.action === 'prepare') {
    if (!account.smtp) fail('SMTP is not configured');
    const input = request.draft || {}; const draft = { from: account.from };
    for (const key of ['to', 'cc', 'bcc']) {
      const values = input[key] || []; if (!Array.isArray(values) || values.length > 50) fail('Recipients must be arrays of at most 50 addresses'); draft[key] = values.map(address);
    }
    if (!draft.to.length) fail('At least one To recipient is required');
    if (typeof input.subject !== 'string' || /[\r\n]/.test(input.subject) || input.subject.length > 1000) fail('Invalid subject');
    if (typeof input.body !== 'string' || input.body.length > 100000) fail('Body must be text of at most 100000 characters');
    draft.subject = input.subject; draft.body = input.body;
    let parentMessageId = null, application = null;
    if (request.messageId) {
      const parent = getMessage(root, request.messageId);
      if (parent.account !== account.id) fail('Reply must use the message account');
      parentMessageId = parent.message_id;
      const references = [...new Set([...(parent.references || []), ...(parent.inReplyTo || []), ...(parent.rfcMessageId ? [parent.rfcMessageId] : [])])];
      draft.inReplyTo = parent.rfcMessageId ? [parent.rfcMessageId] : [];
      draft.references = references;
      const binding = effectiveAssociation(root, parent).application;
      if (binding) {
        if (binding.trackerPath && binding.trackerPath !== canonicalizeTrackerPath(resolveTrackerPath(root))) fail('Tracker path changed since this message was matched; review the match again');
        const current = tracker(root).apps.find(a => a.num === binding.num);
        if (!sameApp(appIdentity(current), { num: binding.num, company: binding.company, role: binding.role, report: binding.report || '' })) fail('Application changed since this message was matched; review the match again');
        application = { num: current.num, appNum: current.num, company: current.company, role: current.role, report: current.report || '', trackerPath: canonicalizeTrackerPath(resolveTrackerPath(root)) };
      }
    }
    if (request.appNum != null) {
      const rows = tracker(root).apps, app = rows.find(a => a.num === request.appNum);
      if (!app) fail('Application not found');
      application = { num: app.num, appNum: app.num, company: app.company, role: app.role, report: app.report || '', trackerPath: canonicalizeTrackerPath(resolveTrackerPath(root)) };
    }
    const logFollowup = request.logFollowup ?? !!application;
    if (typeof logFollowup !== 'boolean') fail('logFollowup must be boolean');
    if (logFollowup && !application) fail('Choose an application before enabling follow-up logging');
    draft.attachments = input.attachments || [];
    if (!Array.isArray(draft.attachments) || draft.attachments.length > 10) fail('At most 10 attachments');
    let bytes = 0;
    for (const a of draft.attachments) {
      if (typeof a.name !== 'string' || !a.name || /[\/\\\r\n\x00]/.test(a.name) || typeof a.dataBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.dataBase64)) fail('Invalid attachment');
      bytes += Buffer.from(a.dataBase64, 'base64').length;
    }
    if (bytes > 10_000_000) fail('Attachments exceed 10 MB');
    draft.attachments = draft.attachments.map(a => {
      const data = Buffer.from(a.dataBase64, 'base64');
      return { name: a.name, dataBase64: a.dataBase64, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    });
    const { wire, rfcMessageId } = await run({ action: 'encode', draft });
    const automation = request.automationDraftId == null ? null : {
      id: String(request.automationDraftId), contextDigest: String(request.automationContextDigest || ''),
    };
    if (automation) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(automation.id) || !/^[a-f0-9]{64}$/.test(automation.contextDigest)) fail('Invalid automation draft context');
      automation.kind = request.automationKind;
      automation.account = account.id;
      automation.messageId = request.messageId || null;
      automation.appNum = application?.num ?? request.appNum ?? null;
      if (!['reply', 'followup'].includes(automation.kind) || !automation.appNum) fail('Automation draft source is incomplete');
      const { mailAutomationDraftIsFresh } = await import('../automation/mail.mjs');
      if (!await mailAutomationDraftIsFresh(root, automation)) fail('Automation draft is stale; refresh its source context before preparing');
    }
    const payload = { account: account.id, draft, wire, rfcMessageId: rfcMessageId || null, transportDigest: digest(account.smtp), application, parentMessageId, logFollowup, automation };
    const saved = { id: randomUUID(), digest: digest(payload), payload }; save(locate(saved.id), saved); return saved;
  }
  fail('Unknown mail action');
}
