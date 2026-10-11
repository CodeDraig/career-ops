import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("relative tracker overrides retain one identity across web and child working directories", (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), "co-tracker-relative-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const core = path.resolve(import.meta.dirname, "../../..");
  for (const dir of ["web/src/lib/core", "data", "web/data", "personal/data"]) mkdirSync(path.join(repo, dir), { recursive: true });
  for (const file of ["path-resolver.mjs", "web/src/lib/core/tracker-files.mjs", "web/src/lib/core/code-root.mjs"]) copyFileSync(path.join(core, file), path.join(repo, file));
  const intended = path.join(repo, "data/applications.md");
  const decoy = path.join(repo, "web/data/applications.md");
  writeFileSync(intended, "intended tracker");
  writeFileSync(decoy, "wrong tracker");
  const env = { ...process.env, CAREER_OPS_ROOT: path.join(repo, "personal"), CAREER_OPS_TRACKER: "data/applications.md", CAREER_OPS_CODE_ROOT: "" };
  function run(cwd, module, body) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import * as tracker from ${JSON.stringify(pathToFileURL(path.join(repo, module)).href)}; ${body}`], { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  assert.equal(run(path.join(repo, "web"), "web/src/lib/core/tracker-files.mjs", 'console.log(tracker.readTrackerFile(process.env.CAREER_OPS_ROOT));'), "intended tracker");
  const writer = run(path.join(repo, "personal"), "path-resolver.mjs", 'console.log(tracker.resolveTrackerPathForWrite(process.env.CAREER_OPS_ROOT));');
  assert.equal(writer, intended);
  const reader = run(repo, "path-resolver.mjs", 'console.log(tracker.resolveTrackerPath(process.env.CAREER_OPS_ROOT));');
  assert.equal(reader, intended);
  writeFileSync(writer, "updated intended tracker");
  assert.equal(readFileSync(decoy, "utf8"), "wrong tracker");
  assert.equal(run(path.join(repo, "web"), "web/src/lib/core/tracker-files.mjs", 'console.log(tracker.readTrackerFile(process.env.CAREER_OPS_ROOT));'), "updated intended tracker");
});
