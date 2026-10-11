// Local fictional forms only. Run explicitly with CAREER_OPS_BROWSER_TESTS=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { tryApplyTrigger } from "../../src/lib/apply/diagnose.ts";

test("initial Apply navigation refuses submit controls and preserves navigation", {
  skip: process.env.CAREER_OPS_BROWSER_TESTS !== "1",
  timeout: 30_000,
}, async (t) => {
  let posts = 0;
  let html = "";
  const server = createServer((req, res) => {
    if (req.method === "POST") posts++;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(req.url === "/application" ? '<input name="email" type="email">' : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());

  for (const [name, control] of [
    ["explicit submit", '<button type="submit">Apply now</button>'],
    ["default submit", '<button>Apply now</button>'],
    ["externally owned submit", '</form><button form="application">Apply now</button>'],
    ["scripted final button", '<button type="button" onclick="this.form.requestSubmit()">Apply now</button>'],
  ]) {
    await t.test(name, async () => {
      html = `<form id="application" method="post" action="/received"><input type="hidden" name="fixture" value="fictional-only">${control}</form>`;
      const page = await browser.newPage();
      try {
        await page.goto(origin);
        const before = posts;
        const acted = await tryApplyTrigger(page);
        assert.equal(posts, before, "initial navigation must not send the local fixture form");
        assert.equal(acted, false, "submit control must be refused");
      } finally { await page.close(); }
    });
  }

  await t.test("ordinary Apply button opens the form", async () => {
    html = '<button type="button" onclick="document.body.innerHTML=\'<input name=email type=email>\'">Apply now</button>';
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      assert.equal(await tryApplyTrigger(page), true);
      assert.equal(await page.locator('input[name="email"]').count(), 1);
    } finally { await page.close(); }
  });

  await t.test("ATS application link opens the form", async () => {
    html = `<a href="${origin}/application">Apply now</a>`;
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      assert.equal(await tryApplyTrigger(page), true);
      assert.equal(page.url(), `${origin}/application`);
    } finally { await page.close(); }
  });

  await t.test("submit-labelled ATS link is not followed", async () => {
    html = `<a href="${origin}/application">Submit application</a>`;
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      assert.equal(await tryApplyTrigger(page), false);
      assert.equal(page.url(), `${origin}/`);
    } finally { await page.close(); }
  });
});
