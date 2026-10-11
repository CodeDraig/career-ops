/**
 * tracker-links.mjs — Shared report-link normalization for the tracker.
 *
 * Markdown links resolve relative to the file that contains them, so a report
 * link in applications.md must be relative to wherever that tracker file lives:
 * `../reports/...` when the tracker is at `data/applications.md`, or
 * `reports/...` when it sits at the repo root.
 *
 * Report files canonically live in `<repoRoot>/reports/`, so we resolve the
 * incoming link to that absolute location regardless of how it was written
 * (root-relative `reports/...` per the TSV convention, or an already-normalized
 * `../reports/...`) and recompute the path with path.relative. Idempotent:
 * re-running never double-prefixes a link. See issue #760.
 */

import { join, relative, sep } from 'path';
import { statSync } from 'fs';

/**
 * Rewrite every report link in a string so its path is relative to trackerDir.
 *
 * @param {string} reportField  Text containing one or more `[label](path)` links.
 * @param {string} trackerDir   Absolute dir of the tracker file (dirname of applications.md).
 * @param {string} repoRoot     Absolute repo root where `reports/` lives.
 * @returns {string} The same text with report links normalized.
 */
export function normalizeReportLink(reportField, trackerDir, repoRoot) {
  return reportField.replace(/\]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (whole, linkPath) => {
    const m = linkPath.match(/^(?:\.\.\/)*(reports\/.+)$/);
    if (!m) return whole; // not a report path — leave untouched
    const reportAbs = join(repoRoot, m[1]);
    const rel = relative(trackerDir, reportAbs).split(sep).join('/');
    return `](${rel})`;
  });
}

/**
 * The ONE rule for "this Report cell links to a report that is not on disk",
 * shared by verify-pipeline.mjs (Check 3), merge-tracker.mjs (merge-time
 * warning, #4748) and fix-report-links.mjs (#4750) so the three can never
 * disagree about which rows are broken.
 *
 * The link is the first markdown `](target)` in the cell. It resolves when it
 * names a REGULAR FILE from the tracker's own directory (markdown links are
 * relative to the file holding them, see #760). A directory is not a report. A cell with no link
 * (`—`, `N/A`, empty) is the documented "no report" convention and is never
 * broken.
 *
 * @param {string} reportCell - Raw Report cell value.
 * @param {string} trackerDir - Directory containing the tracker file.
 * @param {{onInspectionError?: Function, stat?: Function}} [options]
 * @returns {string|null} The unresolved link target, or null when there is no link,
 *   it resolves, or its targets could not be inspected conclusively.
 */
export function findDeadReportLink(reportCell, trackerDir, options = {}) {
  const match = String(reportCell ?? '').match(/\]\(([^)]+)\)/);
  if (!match) return null;
  const link = match[1];
  const inspect = options.stat ?? statSync;
  const path = join(trackerDir, link);
  try {
    return inspect(path).isFile() ? null : link;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return link;
    // Inconclusive inspection must never authorize removal of a report link.
    options.onInspectionError?.({ link, errors: [{ path, error }] });
    return null;
  }
}
