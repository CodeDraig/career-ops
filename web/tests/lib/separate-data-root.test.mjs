import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";

register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const CORE = fileURLToPath(new URL("../../../", import.meta.url));
const { addOffersToPipeline } = await import("../../src/lib/core/pipeline.ts");
const { POST: skip } = await import("../../src/app/api/inbox/skip/route.ts");
const { POST: status } = await import("../../src/app/api/status/route.ts");
const { readApplications, pdfPathForReport } = await import("../../src/lib/career-ops.ts");
const { getNormalizeTextKey } = await import("../../src/lib/core/text-key.ts");
const { normalizeTextKey } = await import("../../../tracker-parse.mjs");
const { withTrackerLock } = await import("../../src/lib/core/tracker-lock.ts");
const { withFollowupsLock, FollowupsBusyError } = await import("../../src/lib/core/followups-lock.ts");
let trackerLockDirFor, holdFollowupsLock, skipCore = false;
try {
  ({ trackerLockDirFor } = await import("../../../tracker-utils.mjs"));
  ({ withFollowupsLock: holdFollowupsLock } = await import("../../../followup-seed.mjs"));
} catch (error) {
  // web-ci installs only web/node_modules. Like the existing core adapter
  // suites, skip integration there; a broken installed core must still fail.
  if (error.code !== "ERR_MODULE_NOT_FOUND" || fs.existsSync(path.join(CORE, "node_modules"))) throw error;
  skipCore = "core dependencies are not installed (web-only checkout)";
}

function fixture(t) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "co-web-separate-"));
  fs.mkdirSync(path.join(data, "data"));
  const previous = { ...process.env };
  process.env.CAREER_OPS_ROOT = data;
  process.env.CAREER_OPS_CODE_ROOT = CORE;
  delete process.env.CAREER_OPS_TRACKER;
  delete process.env.CAREER_OPS_PDF_INDEX;
  t.after(() => {
    for (const key of ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_CODE_ROOT", "CAREER_OPS_TRACKER", "CAREER_OPS_PDF_INDEX", "CAREER_OPS_WEB_FOLLOWUPS_LOCK_TIMEOUT_MS"]) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    fs.rmSync(data, { recursive: true, force: true });
  });
  return data;
}

function request(body) {
  return new Request("http://fixture.invalid/", { method: "POST", body: JSON.stringify(body) });
}

test("separate data root: add and skip use the installed core writers", { skip: skipCore }, async (t) => {
  const data = fixture(t);
  const url = "https://fixture.invalid/jobs/42";
  const result = await addOffersToPipeline([{ url, company: "Fictional Fixture", title: "Engineer" }]);
  assert.deepEqual(result, { added: 1, error: undefined });
  assert.match(fs.readFileSync(path.join(data, "data/pipeline.md"), "utf8"), /\[ \].*fixture\.invalid\/jobs\/42/);
  assert.ok(fs.readFileSync(path.join(data, "data/scan-history.tsv"), "utf8").includes(url));
  const response = await skip(request({ url, done: true }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(fs.readFileSync(path.join(data, "data/pipeline.md"), "utf8"), /\[x\].*fixture\.invalid\/jobs\/42/);
});

test("separate data root: core import failures are reported, not added:0 success", async (t) => {
  const data = fixture(t);
  const code = path.join(data, "incomplete-engine");
  fs.mkdirSync(code);
  fs.writeFileSync(path.join(code, "scan.mjs"), 'throw new Error("fixture writer load failure");');
  process.env.CAREER_OPS_CODE_ROOT = code;
  const result = await addOffersToPipeline([{ url: "https://fixture.invalid/job" }]);
  assert.equal(result.added, 0);
  assert.ok(result.error, "an exited writer with no JSON must be a failure");
});

test("separate data root: tracker reader and real status CLI share a relative override", { skip: skipCore }, async (t) => {
  const data = fixture(t);
  const tracker = path.join(data, "data/applications.md");
  fs.writeFileSync(tracker, "# Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-10-10 | Fictional Fixture | Engineer | 3/5 | Evaluated | ❌ | — | Fixture |\n");
  process.env.CAREER_OPS_TRACKER = path.relative(CORE, tracker);
  assert.equal(readApplications()[0].status, "Evaluated");
  const response = await status(request({ n: "1", status: "Applied" }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(readApplications()[0].status, "Applied");
  assert.match(fs.readFileSync(path.join(data, "data/status-log.tsv"), "utf8"), /Evaluated\tApplied\tweb/);
});

test("separate data root: shared locks, normalization and PDF lookup load the installed engine", { skip: skipCore }, async (t) => {
  const data = fixture(t);
  assert.equal(await getNormalizeTextKey(), normalizeTextKey, "use the actual core export");
  const tracker = path.join(data, "data/applications.md");
  fs.writeFileSync(tracker, "# Fixture tracker\n");
  const lockDir = trackerLockDirFor(tracker);
  await withTrackerLock(tracker, () => assert.ok(fs.existsSync(lockDir)));
  assert.equal(fs.existsSync(lockDir), false);
  fs.mkdirSync(path.join(data, "output"));
  const pdf = path.join(data, "output/fixture.pdf");
  fs.writeFileSync(pdf, "fixture placeholder, only path lookup is under test");
  fs.writeFileSync(path.join(data, "data/pdf-index.tsv"), "report\tpath\n1\toutput/fixture.pdf\n");
  assert.equal(await pdfPathForReport("1"), pdf);
});

test("separate data root: follow-up edits contend on the core seeder's lock", { skip: skipCore }, async (t) => {
  const data = fixture(t);
  const file = path.join(data, "data/follow-ups.md");
  let entered, release;
  const acquired = new Promise((resolve) => { entered = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const owner = holdFollowupsLock(file, async () => { entered(); await hold; });
  await acquired;
  process.env.CAREER_OPS_WEB_FOLLOWUPS_LOCK_TIMEOUT_MS = "25";
  try {
    await assert.rejects(withFollowupsLock(file, () => assert.fail("must not bypass the seeder's lock")), FollowupsBusyError);
  } finally { release(); await owner; }
});

test("marker-selected data root is passed to the spawned pipeline writer", { skip: skipCore }, async (t) => {
  const data = fixture(t);
  const code = path.join(data, "engine");
  fs.mkdirSync(code);
  fs.symlinkSync(path.join(CORE, "scan.mjs"), path.join(code, "scan.mjs"));
  fs.symlinkSync(path.join(CORE, "lib"), path.join(code, "lib"), "dir");
  fs.writeFileSync(path.join(code, ".career-ops-data"), "..\n");
  process.env.CAREER_OPS_CODE_ROOT = code;
  delete process.env.CAREER_OPS_ROOT;
  delete process.env.CAREER_OPS_DATA_DIR;
  const result = await addOffersToPipeline([{ url: "https://fixture.invalid/marker-job" }]);
  assert.deepEqual(result, { added: 1, error: undefined });
  assert.ok(fs.readFileSync(path.join(data, "data/pipeline.md"), "utf8").includes("https://fixture.invalid/marker-job"));
});
