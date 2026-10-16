import { readIndeed } from './browser-harness/runner.mjs';

const key = /^[a-f0-9]{16}$/i;
const text = value => typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500) : '';

export function indeedRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an Indeed search request.');
  if (input.action === 'job') {
    if (typeof input.id !== 'string' || !key.test(input.id)) throw new Error('A valid Indeed job key is required.');
    return { action: 'job', url: `https://www.indeed.com/viewjob?jk=${input.id}` };
  }
  if (input.action && input.action !== 'search') throw new Error('Unknown Indeed action.');
  if (typeof input.keywords !== 'string' || !input.keywords.trim() || input.keywords.length > 200) throw new Error('Enter search keywords (up to 200 characters).');
  if (input.location !== undefined && (typeof input.location !== 'string' || input.location.length > 200)) throw new Error('Location must be text (up to 200 characters).');
  const url = new URL('https://www.indeed.com/jobs');
  url.searchParams.set('q', input.keywords.trim());
  url.searchParams.set('l', (input.location || '').trim());
  return { action: 'search', url: url.href };
}

export const indeedMessages = {
  busy: 'Another Indeed search is using the Chrome extension. Retry when it finishes.',
  unsupported_browser: 'Select a Chrome extension connection in Browser Harness. This Indeed adapter requires Chrome page JavaScript.',
  challenge: 'Indeed requires browser verification. Complete it in the Chrome extension tab, then retry.',
  login_required: 'Indeed requires sign-in. Complete it in the Chrome extension tab, then retry.',
  unavailable: 'Indeed did not expose readable results. Open the search in Chrome or retry later; this is not a zero-results result.',
  not_configured: 'Browser Harness was not found. Set CAREER_OPS_BROWSER_HARNESS_BIN to the local browser-harness executable, then restart Career-Ops.',
  browser_unavailable: 'Browser Harness could not read the page. Check the extension setup, connect the Chrome extension, and select its profile in the career-ops harness session, then retry.',
};

export function normalizeIndeed(raw, request) {
  const status = raw?.status;
  if (['ok', 'empty'].includes(status)) {
    try {
      const actual = new URL(raw.url), expected = new URL(request.url);
      const params = request.action === 'job' ? ['jk'] : ['q', 'l'];
      if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || params.some(p => actual.searchParams.get(p) !== expected.searchParams.get(p))) return normalizeIndeed(null, request);
    } catch { return normalizeIndeed(null, request); }
  }
  if (!['ok', 'empty'].includes(status)) {
    const known = Object.hasOwn(indeedMessages, status) ? status : 'unavailable';
    return { status: known, url: request.url, message: indeedMessages[known], offers: [] };
  }
  if (request.action === 'job') {
    if (status !== 'ok' || typeof raw.description !== 'string' || (!raw.description.trim() && raw.closed !== true)) return normalizeIndeed(null, request);
    return { status: 'ok', url: request.url, title: text(raw.title), description: raw.description.slice(0, 200000), closed: raw.closed === true };
  }
  if (!Array.isArray(raw.jobs)) return normalizeIndeed(null, request);
  const seen = new Set();
  const offers = raw.jobs.flatMap(job => {
    if (!job || typeof job.id !== 'string' || !key.test(job.id) || !text(job.title) || seen.has(job.id.toLowerCase())) return [];
    const id = job.id.toLowerCase(); seen.add(id);
    return [{ id, url: `https://www.indeed.com/viewjob?jk=${id}`, title: text(job.title), company: text(job.company), location: text(job.location), postedAt: '', ats: 'indeed', source: 'indeed', verification: 'unconfirmed', note: 'Indeed discovery; employer opening not yet verified.' }];
  }).slice(0, 50);
  if (status === 'ok' && !offers.length) return normalizeIndeed(null, request);
  return { status: offers.length ? 'ok' : 'empty', url: request.url, offers, warnings: ['One page of Indeed results, which may include sponsored or loosely related listings. Confirm remote eligibility and location on each posting; employer openings are unverified.', ...(raw.jobs.length > offers.length ? ['Some duplicate, incomplete or excess cards were omitted.'] : [])] };
}

export async function searchIndeed(input, { read = readIndeed } = {}) {
  const request = indeedRequest(input);
  return normalizeIndeed(await read(request.url), request);
}
