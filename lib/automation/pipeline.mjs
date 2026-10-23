// Reuse the same prompt builders, canonical report/tracker verification and
// document renderers as the web workflows, and the scanner's actual eligibility
// filters before reserving a role allocation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { discoverPipeline, executeRole, pipelinePreflight as baseProfilePreflight } from '../../web/src/lib/automation/pipeline.mjs';
import { slugify } from '../../web/src/lib/pdf-paths.mjs';
import { checkCodexLogin } from './execution.mjs';
import { withResourceLock } from '../../web/src/lib/scheduled-jobs-store.mjs';
import { scheduledRunnerResourcePath, scheduledStorePath } from '../../web/src/lib/scheduled-runner-path.mjs';
import { readLivenessInBrowser } from '../browser-harness/runner.mjs';
import { rejectPrivateOrInvalid, validateUrlSecurity } from '../../liveness-browser.mjs';
export { discoverPipeline, executeRole };
const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const normalizedUrl = value => { try { const url = new URL(value); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|source|tracking)/i.test(key)) url.searchParams.delete(key); return url.href.replace(/\/$/, ''); } catch { return String(value ?? '').trim(); } };

/** Profile/input-only preflight for revision detection; no auth or network work. */
export function profilePreflight(root, task) {
  return baseProfilePreflight(root, task);
}

export async function pipelinePreflight(root, task, { checkLogin = true, checkLiveness, checkLivenessApi, checkBrowserLiveness } = {}) {
  const base = profilePreflight(root, task);
  if (!base.ok) return base;
  task = task?.payload ? { ...task, ...task.payload } : task;
  if (checkLogin) {
    const login = await checkCodexLogin();
    if (!login.ok) return { ok: false, reason: login.reason, requiredAction: 'Authenticate Codex in this instance before enabling role packet execution.' };
  }
  const urlKey = normalizedUrl(task.url);
  const pending = discoverPipeline(root).some(item => item.key === urlKey);
  const checkpointReport = task.checkpoint?.reportNum && (() => {
    try {
      const name = fs.readdirSync(path.join(root, 'reports')).find(item => item.startsWith(`${task.checkpoint.reportNum}-`) && /^\d+-.+\.md$/i.test(item));
      if (!name) return false;
      const report = fs.readFileSync(path.join(root, 'reports', name), 'utf8');
      return normalizedUrl(report.match(/^\*\*URL:\*\*\s*(\S+)/mi)?.[1] || '') === urlKey;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  })();
  if (!pending && !checkpointReport) {
    return { ok: false, reason: 'This URL is no longer in the pending pipeline.', requiredAction: 'Restore it to Pending or dismiss the automation task.' };
  }
  const portalsFile = path.join(root, 'portals.yml');
  let portals = {};
  try { portals = yaml.load(fs.readFileSync(portalsFile, 'utf8')) || {}; }
  catch (error) { return { ok: false, reason: `Cannot read portals.yml: ${error.message}`, requiredAction: 'Repair the portals configuration.' }; }
  if (!portals || typeof portals !== 'object' || Array.isArray(portals)) return { ok: false, reason: 'portals.yml must contain a YAML mapping.', requiredAction: 'Repair the portals configuration.' };

  const scan = await import('../../scan.mjs');
  const blacklistFile = path.join(root, 'data', 'blacklist.md');
  let blacklist = new Map();
  try { blacklist = scan.parseBlacklist(fs.readFileSync(blacklistFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') return { ok: false, reason: `Cannot read data/blacklist.md: ${error.message}`, requiredAction: 'Repair the blacklist file.' }; }
  const blocked = scan.findBlacklistEntry(blacklist, task.company, task.url);
  if (blocked) return { ok: false, reason: `${blocked.company} is on the candidate's do-not-apply list${blocked.reason ? `: ${blocked.reason}` : ''}.`, requiredAction: 'Review the blacklist entry and remove the URL from automation if appropriate.' };

  const title = String(task.role ?? '').trim();
  if (!title && Array.isArray(portals.title_filter?.positive) && portals.title_filter.positive.length) {
    return { ok: false, reason: 'The pending item has no role title, so its saved title filter cannot be checked.', requiredAction: 'Add the posting company and role to its pending pipeline row.' };
  }
  if (title && portals.title_filter) {
    const overrides = scan.buildTitleFilterOverrides(portals.title_filter_overrides);
    const matches = scan.buildTitleFilterWithOverrides(portals.title_filter, overrides);
    if (!matches(title, slugify(task.company ?? ''))) return { ok: false, reason: `Role title does not pass the saved title filters: ${title}.`, requiredAction: 'Review the role and update its targeting or saved filters.' };
  }
  if (portals.location_filter) {
    const location = String(task.location ?? '').trim();
    const matches = scan.buildLocationFilter(portals.location_filter);
    if (!matches(location, task.url, title)) return { ok: false, reason: 'Role location does not pass the saved location filter.', requiredAction: 'Review the role location and saved location rules.' };
  }

  const matchingReportExists = (() => {
    try {
      return fs.readdirSync(path.join(root, 'reports')).some(name => {
        if (!/^\d+-.+\.md$/i.test(name)) return false;
        const report = fs.readFileSync(path.join(root, 'reports', name), 'utf8');
        const url = report.match(/^\*\*URL:\*\*\s*(\S+)/mi)?.[1];
        return url === task.url;
      });
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  })();
  const trackerPath = process.env.CAREER_OPS_TRACKER?.trim()
    ? path.resolve(CODE_ROOT, process.env.CAREER_OPS_TRACKER)
    : path.join(root, 'data', 'applications.md');
  const trackerText = (() => { try { return fs.readFileSync(trackerPath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; } })();
  const trackerHasUrl = trackerText.split(/\r?\n/).some(line => line.includes(task.url) && line.includes('|'));
  if (trackerHasUrl && !matchingReportExists && !task.forceReevaluation) {
    return { ok: false, reason: 'This posting already has a tracker row but no matching evaluation report.', requiredAction: 'Review the tracker row before evaluating this URL again.' };
  }

  let liveness;
  if (checkLiveness) {
    // Injection seam for isolated tests; injected results represent the final
    // verdict so tests never require a real Browser Harness connection.
    liveness = await checkLiveness(task.url);
  } else {
    liveness = await withResourceLock(scheduledRunnerResourcePath(scheduledStorePath(root)), async () => {
      const api = await (checkLivenessApi ?? (url => import('../../liveness-api.mjs').then(module => module.checkLivenessViaApi(url))))(task.url);
      if (api?.result === 'active' || api?.result === 'expired') return api;
      const unsafe = rejectPrivateOrInvalid(task.url);
      if (unsafe) return { result: 'uncertain', code: 'unsafe_url', reason: unsafe };
      if (!checkBrowserLiveness) {
        try { await validateUrlSecurity(task.url); }
        catch (error) { return { result: 'uncertain', code: 'unsafe_url', reason: error.message }; }
      }
      return (checkBrowserLiveness ?? readLivenessInBrowser)(task.url);
    }, { timeoutMs: 1000, staleMs: 120_000 });
  }
  if (liveness?.result === 'expired') return { ok: false, reason: 'The existing ATS liveness check confirms this posting has expired.', requiredAction: 'Review the closed posting; it will not be evaluated automatically.' };
  if (liveness?.result === 'uncertain') return { ok: false, reason: 'The existing ATS liveness check could not confirm this posting is active.', requiredAction: 'Verify the posting is still open, then retry the role packet.' };
  if (liveness?.result !== 'active') return { ok: false, reason: 'No liveness check could confirm that this posting is active.', requiredAction: 'Verify the posting is open in the browser, then retry the role packet.' };

  return base;
}
