import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveColumns, parseTrackerRow } from '../tracker-parse.mjs';
import { resolveTrackerPath } from '../path-resolver.mjs';
import { hasProposalReceipt } from './reply-proposals.mjs';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Apply one already reviewed reply proposal through the canonical tracker writer. */
export async function applyReplyStatusProposal(root, update) {
  const trackerPath = resolveTrackerPath(root);
  if (!fs.existsSync(trackerPath)) throw new Error('Applications tracker is missing');
  const content = fs.readFileSync(trackerPath, 'utf8');
  const lines = content.split('\n');
  const columns = resolveColumns(lines);
  const apps = lines.map(line => parseTrackerRow(line, columns)).filter(Boolean);
  const matches = apps.filter(app => app.num === update?.application?.num);
  const snapshot = matches[0] && { num: matches[0].num, date: matches[0].date, company: matches[0].company, role: matches[0].role, report: matches[0].report || '' };
  if (matches.length !== 1 || JSON.stringify(snapshot) !== JSON.stringify(update.application)) throw new Error('Application changed since review; review the proposal again');
  if (!['from_status', 'to_status', 'source', 'evidence'].every(k => update?.[k] !== undefined)) throw new Error('Incomplete reply proposal');
  const { loadCanonicalStates } = await import('../tracker-utils.mjs');
  const states = loadCanonicalStates(path.join(CODE_ROOT, 'templates/states.yml'));
  const from = states.find(state => state.id === update.from_status);
  if (!from || matches[0].status !== from.label) throw new Error('Application status changed since review; review the proposal again');
  const receipt = `[reply-proposal:${createHash('sha256').update(JSON.stringify([update.source.kind, update.source.account_id, update.source.message_id])).digest('hex')}]`;
  if (hasProposalReceipt(apps, receipt)) throw new Error('Reply proposal was already accepted');
  const expected = createHash('sha256').update(content).digest('hex');
  const output = execFileSync(process.execPath, [path.join(CODE_ROOT, 'set-status.mjs'), '--row', String(matches[0].num), update.to_status,
    '--source', 'reply-watch', '--expect-tracker', expected, '--note', receipt, '--json'], {
    encoding: 'utf8', env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: trackerPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}
