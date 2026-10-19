// Explicit Playwright integration; all pages are local route fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readJobDom } from '../browser-extract.mjs';
import { pass, fail } from './helpers.mjs';
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const description = 'Teach students and prepare instructional materials. '.repeat(15);
  await page.route('https://college.csod.com/**', route => route.fulfill({ contentType: 'text/html', body: `<main id="content">Loading job</main><script>setTimeout(()=>document.getElementById('content').innerHTML='<h1>Faculty</h1><p>${description}</p>',600)</script>` }));
  await page.goto('https://college.csod.com/ux/ats/careersite/1/home/requisition/123');
  assert.ok((await readJobDom(page, 4000)).text.includes(description));
  pass('CSOD extraction waits for the delayed job heading instead of emitting site navigation');
  let external = false, inline = false;
  await page.route('https://college.icims.com/**', route => {
    const u = new URL(route.request().url());
    const body = u.searchParams.has('in_iframe') || inline ? `<main><h1>Faculty</h1><p>${description}</p></main>` : `<iframe src="${external ? 'https://other.example' : 'https://college.icims.com'}/jobs/123/faculty/job?in_iframe=1"></iframe>`;
    return route.fulfill({ contentType: 'text/html', body });
  });
  await page.route('https://other.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Unrelated</h1>' }));
  const url = 'https://college.icims.com/jobs/123/faculty/job';
  await page.goto(url);
  const context = page.context();
  const newSession = context.newCDPSession.bind(context);
  let trees = 0;
  context.newCDPSession = async target => {
    const session = await newSession(target);
    const send = session.send.bind(session);
    session.send = async (method, params) => {
      if (method === 'Page.getFrameTree' && ++trees === 2) {
        await page.frames()[1].evaluate(() => history.replaceState(null, '', location.href + '&width=1250'));
      }
      return send(method, params);
    };
    return session;
  };
  try { assert.ok((await readJobDom(page, 3000)).text.includes(description)); }
  finally { context.newCDPSession = newSession; }
  assert.equal(page.url(), url);
  inline = true; await page.goto(url);
  assert.ok((await readJobDom(page, 1000)).text.includes(description));
  assert.equal(page.url(), url);
  inline = false; external = true; await page.goto(url);
  await assert.rejects(readJobDom(page, 500), /frame did not load/);
  assert.equal(page.url(), url);
  pass('iCIMS reads its same-origin same-job iframe, preserves inline jobs and refuses unrelated frames');
} catch (e) { fail(`Job-description integration: ${e.stack}`); process.exitCode = 1; }
finally { await browser?.close(); }
