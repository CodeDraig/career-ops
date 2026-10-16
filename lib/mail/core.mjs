import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot } from '../../path-resolver.mjs';
import { withPipelineLock } from '../../pipeline-lock.mjs';
import { writeFileAtomic } from '../../tracker-utils.mjs';
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
function accounts(root) {
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
function address(s) { if (typeof s !== 'string' || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(s)) fail('Use plain email addresses without display names'); return s; }
function save(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); writeFileAtomic(file, JSON.stringify(data, null, 2), { mode: 0o600 }); }
export async function mail(request, { root = getCareerOpsRoot(), run = transport } = {}) {
  const list = ['accounts', 'fetch', 'prepare', 'send'].includes(request.action) ? accounts(root) : [];
  if (request.action === 'accounts') return { accounts: list.map(a => ({ id: a.id, from: a.from, imap: !!a.imap, smtp: !!a.smtp, ready: ['imap', 'smtp'].filter(k => a[k] && !!process.env[a[k].secretEnv]) })) };
  const outbox = path.join(root, 'data/mail/outbox');
  const locate = id => { if (!/^[a-f0-9-]{36}$/.test(id || '')) fail('Invalid mail id'); return path.join(outbox, id + '.json'); };
  if (request.action === 'history') {
    if (!fs.existsSync(outbox)) return { drafts: [] };
    const files = fs.readdirSync(outbox).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
      .map(name => ({ name, modified: fs.statSync(path.join(outbox, name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified);
    const drafts = [];
    for (const { name } of files) {
      const file = path.join(outbox, name), saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.kind === 'inbox') continue;
      const receipt = fs.existsSync(file + '.receipt.json') ? JSON.parse(fs.readFileSync(file + '.receipt.json', 'utf8')) : null;
      drafts.push({ id: saved.id, subject: saved.payload.draft.subject, from: saved.payload.draft.from, status: receipt?.status || 'prepared' });
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
      if (request.action === 'review') return { ...saved, receipt: fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null };
      if (request.confirm !== saved.digest) fail('Send requires the reviewed digest');
      if (fs.existsSync(receiptPath)) fail('A send was already attempted; inspect its receipt. Automatic replay is disabled');
      const account = list.find(a => a.id === saved.payload.account);
      if (!account?.smtp || account.from !== saved.payload.draft.from || digest(account.smtp) !== saved.payload.transportDigest) fail('SMTP configuration changed; prepare and review again');
      if (!process.env[account.smtp.secretEnv]) fail('SMTP credential environment variable is missing');
      const receipt = { id: request.id, attemptedAt: new Date().toISOString(), status: 'unknown' };
      save(receiptPath, receipt);
      try {
        Object.assign(receipt, await run({ action: 'send', config: account.smtp, wire: saved.payload.wire, sender: account.from, recipients: [...new Set(['to', 'cc', 'bcc'].flatMap(k => saved.payload.draft[k]))] }));
      } catch (e) { receipt.error = e.message; }
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
    const { wire } = await run({ action: 'encode', draft });
    const payload = { account: account.id, draft, wire, transportDigest: digest(account.smtp) };
    const saved = { id: randomUUID(), digest: digest(payload), payload }; save(locate(saved.id), saved); return saved;
  }
  fail('Unknown mail action');
}
