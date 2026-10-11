#!/usr/bin/env node
/**
 * normalize-statuses.mjs — Clean non-canonical states in applications.md
 *
 * Normalizes casing of canonical labels from templates/states.yml.
 * Unknown values are reported without guessing a replacement.
 *
 * Run: node career-ops/normalize-statuses.mjs [--dry-run]
 */

import { readFileSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import {
  openTrackerTransaction, rebuildRow,
  loadCanonicalStates, resolveCanonicalState,
} from './tracker-utils.mjs';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';
import { validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

// System Layer files (templates/, modes/, scripts) live in the codebase and are
// resolved from this module's own directory; only User Layer data follows the
// configurable data root. Binding both to getCareerOpsRoot() made states.yml
// unreadable under CAREER_OPS_ROOT / .career-ops-data, and the catch below
// turned that into a silent "everything is unknown" (#3500).
const CODEBASE_ROOT = dirname(fileURLToPath(import.meta.url));
const CAREER_OPS = getCareerOpsRoot();
const APPS_FILE = resolveTrackerPath(CAREER_OPS);

// Canonical status mapping
let statesCache = null;
/** Canonical states from templates/states.yml, read once per CLI run. */
function canonicalStates() {
  if (statesCache) return statesCache;
  const statesFile = join(CODEBASE_ROOT, 'templates', 'states.yml');
  try {
    statesCache = loadCanonicalStates(statesFile);
  } catch (err) {
    // Broken install: fall through to "unknown", never a stale copy — but say
    // so. The silent [] is what made #3500 invisible: a states.yml looked up in
    // the wrong tree is indistinguishable from one that is genuinely missing,
    // and the whole tracker normalized to unknown without a word.
    console.error(`[normalize-statuses] cannot read canonical states from ${statesFile}: ${err.message}`);
    console.error('[normalize-statuses] every status will be reported as unknown until this is fixed.');
    statesCache = [];
  }
  return statesCache;
}

function normalizeStatus(raw) {
  const status = resolveCanonicalState(raw, canonicalStates());
  return status ? { status } : { status: null, unknown: true };
}

export { normalizeStatus };

const KNOWN_FLAGS = ['--help', '-h', '--dry-run'];
const USAGE = `Usage: node normalize-statuses.mjs [options]

  Options:
  --dry-run        Report what would change without writing applications.md
  -h, --help       Show this help and exit
  `;

// Everything below is the CLI. It is guarded because importing this module used to
// run it: the import alone opened a tracker transaction and rewrote applications.md.
// That is why tests could only scrape this file's source with regexes instead of
// calling the function.
const IS_CLI = isMainModule(import.meta.url);

if (IS_CLI) {
const args = process.argv.slice(2);

// Unrecognized flags exit 1 naming the flag; --help/-h print USAGE and exit 0.
validateFlags(args, KNOWN_FLAGS, USAGE);

// Read applications.md
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to normalize.');
  process.exit(0);
}

const DRY_RUN = process.argv.includes('--dry-run');
let trackerTransaction = null;
if (!DRY_RUN) {
  try {
    trackerTransaction = await openTrackerTransaction(APPS_FILE);
  } catch (err) {
    console.error(`Cannot acquire tracker lock: ${err.message}`);
    process.exit(1);
  }
  process.once('exit', () => {
    try { trackerTransaction.close(); } catch {}
  });
}
try {
const content = trackerTransaction ? trackerTransaction.read() : readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

let changes = 0;
let unknowns = [];

// Map columns by header name (tracker-parse.mjs, #954/#1596). Fixed indices
// assumed the original 9-column layout, so a customized tracker — an inserted
// Location or Via column — shifted every field one to the left: the Score cell
// was normalized as if it were the status and overwritten, while the real
// status was left alone and reported as unknown (#1955).
const COLS = resolveColumns(lines);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const row = parseTrackerRow(line, COLS);
  if (!row) continue; // header, separator, non-row, or a row missing cells

  const parts = line.split('|').map(s => s.trim());
  const num = row.num;
  const rawStatus = row.status;
  const result = normalizeStatus(rawStatus);

  if (result.unknown) {
    unknowns.push({ num, rawStatus, line: i + 1 });
    continue;
  }

  if (result.status === rawStatus) continue; // Already canonical

  // Apply change
  const oldStatus = rawStatus;
  parts[COLS.status] = result.status;

  // Move DUPLICADO info to notes if needed. A layout without a Notes column
  // has nowhere to put it — dropping the provenance beats appending a cell the
  // table has no header for.
  if (result.moveToNotes && COLS.notes != null) {
    const existing = parts[COLS.notes] || '';
    if (!existing.includes(result.moveToNotes)) {
      parts[COLS.notes] = result.moveToNotes + (existing ? '. ' + existing : '');
    }
  }

  // Also strip bold from score field
  if (parts[COLS.score]) {
    parts[COLS.score] = parts[COLS.score].replace(/\*\*/g, '');
  }

  // Reconstruct line
  const newLine = rebuildRow(parts);
  lines[i] = newLine;
  changes++;

  console.log(`#${num}: "${oldStatus}" → "${result.status}"`);
}

if (unknowns.length > 0) {
  console.log(`\n⚠️  ${unknowns.length} unknown statuses:`);
  for (const u of unknowns) {
    console.log(`  #${u.num} (line ${u.line}): "${u.rawStatus}"`);
  }
}

console.log(`\n📊 ${changes} statuses normalized`);

if (!DRY_RUN && changes > 0) {
  // Backup first
  const backupPath = `${APPS_FILE}.bak`;
  copyFileSync(APPS_FILE, backupPath);
  trackerTransaction.replace(lines.join('\n'));
  console.log(`✅ Written to ${APPS_FILE} (backup: ${backupPath})`);
} else if (DRY_RUN) {
  console.log('(dry-run — no changes written)');
} else {
  console.log('✅ No changes needed');
}
} finally {
  trackerTransaction?.close();
}
} // end IS_CLI
