// Run explicitly: node tests/browser-listing-cards.integration.mjs
// Requires the installed Playwright Chromium; the default unit suite needs no browser.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pass, fail } from './helpers.mjs';
import { readDom, normalizeListing } from '../browser-extract.mjs';
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<base href="https://jobs.example.edu/postings/search"><main>
    <a href="#filters">REMOTE</a><a href="?sort=title">Sort by Job Title</a>
    <a href="/login">Login to Apply /Create Account</a><a href="/interest_cards">Job Alerts</a>
    <a href="/talentnetwork/">Join Our Talent Network</a>
    <div><p>Nursing Instructor</p><a href="/jobs/122/nursing"><button title="Job #122 - Nursing Instructor">More Info</button></a></div>
    <div><h3>Math Instructor</h3><div><a href="/jobs/123/math"><button>More Info</button></a></div></div>
    <div><h3>Writing Instructor</h3><a href="/jobs/124/writing">More Info</a></div>
    <div><h3>History Instructor</h3><h3>Science Instructor</h3><a href="/jobs/125/ambiguous">More Info</a></div>
    <a href="/jobs/126/history">READ MORE ABOUT
 "History Faculty"</a>
    <h3><a href="/postings/99">Composition Faculty</a></h3>
    <a href="/postings/99">View Details</a><a href="/bookmarks?posting_id=99">Bookmark</a>
  </main>`);
  const raw = await readDom(page);
  const result = normalizeListing(raw.anchors, 'https://jobs.example.edu/postings/search');
  assert.deepEqual(result.jobs.map(j => j.title), ['Nursing Instructor', 'Math Instructor', 'Writing Instructor', 'History Faculty', 'Composition Faculty']);
  assert.deepEqual(result.jobs.map(j => j.url), ['https://jobs.example.edu/jobs/122/nursing', 'https://jobs.example.edu/jobs/123/math', 'https://jobs.example.edu/jobs/124/writing', 'https://jobs.example.edu/jobs/126/history', 'https://jobs.example.edu/postings/99']);
  assert.equal(normalizeListing(raw.anchors, 'https://jobs.example.edu/postings/search', 1).jobs[0].title, 'Nursing Instructor');
  const queryJobs = normalizeListing([
    {href: '?JobOpeningId=123', label: 'Faculty Position'},
    {href: '#/jobs/456', label: 'Teaching Position'},
    {href: '#filters', label: 'Filter Jobs'},
    {href: '?sort=title', label: 'Job Title'},
  ], 'https://jobs.example.edu/search');
  assert.equal(queryJobs.jobs.length, 2);
  // A third-party script can replace DOM methods in the main world.
  await page.evaluate(() => {
    Document.prototype.querySelector = () => { throw new TypeError('analytics wrapper failed'); };
    Element.prototype.querySelectorAll = () => { throw new TypeError('analytics wrapper failed'); };
  });
  const isolated = await readDom(page);
  assert.deepEqual(isolated.anchors, raw.anchors);
  assert.equal(isolated.text, raw.text);
  pass('DOM extraction survives page-script replacements of native DOM methods');

  // Force a real redirect between world creation and extraction, rather than
  // relying on a timing-sensitive sleep to reproduce a destroyed context.
  await page.route('https://redirect.example/**', route => route.fulfill({
    contentType: 'text/html', body: '<main><h1>Destination</h1><a href="/jobs/42">Faculty Position</a></main>',
  }));
  const context = page.context();
  const newSession = context.newCDPSession.bind(context);
  let attempts = 0;
  context.newCDPSession = async target => {
    const session = await newSession(target);
    const send = session.send.bind(session);
    session.send = async (method, params) => {
      if (method === 'Runtime.callFunctionOn' && attempts++ === 0) {
        await page.goto('https://redirect.example/final');
      }
      return send(method, params);
    };
    return session;
  };
  try {
    const redirected = await readDom(page);
    assert.equal(attempts, 2);
    assert.equal(redirected.title, 'Destination');
    assert.equal(redirected.documentUrl, 'https://redirect.example/final');
    assert.equal(normalizeListing(redirected.anchors, redirected.documentUrl).jobs[0].url, 'https://redirect.example/jobs/42');
  } finally { context.newCDPSession = newSession; }
  pass('DOM extraction retries a destroyed context and returns the destination URL with its content');
  for (const [message, expectedAttempts] of [
    ['Cannot find context with specified id', 3],
    ['Unexpected extraction failure', 1],
  ]) {
    let calls = 0;
    let detached = false;
    const fakePage = {
      context: () => ({ newCDPSession: async () => ({
        send: async () => { calls++; throw new Error(message); },
        detach: async () => { detached = true; },
      }) }),
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
    };
    await assert.rejects(readDom(fakePage), error => error.message === message);
    assert.equal(calls, expectedAttempts);
    assert.equal(detached, true);
  }
  pass('Navigation retries are bounded, unrelated failures propagate, and CDP sessions detach on failure');
  pass('Browser listing excludes navigation, pairs button links with their own heading and rejects ambiguous cards before applying the cap');
} catch (e) { fail(`Browser listing cards: ${e.stack}`); process.exitCode = 1; }
finally { await browser?.close(); }
