import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverPipeline, executeRole, pipelinePreflight } from "../../src/lib/automation/pipeline.mjs";
import { pipelinePreflight as pipelinePreflightWithGates } from "../../../lib/automation/pipeline.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-automation-pipeline-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.mkdirSync(path.join(root, "modes"), { recursive: true });
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "cv.md"), "# Candidate\n\n## Experience\nWork\n");
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "candidate:\n  full_name: Candidate Example\ncv:\n  output_format: pdf\nauto_pdf_score_threshold: 3\n");
  fs.writeFileSync(path.join(root, "modes", "_profile.md"), "Targeting: support engineering.\n");
  fs.writeFileSync(path.join(root, "portals.yml"), "companies: []\n");
  fs.writeFileSync(path.join(root, "data", "pipeline.md"), [
    "# Pipeline",
    "## Pending",
    "- [ ] https://jobs.example/role-1 | Acme | Support Engineer | Remote | posted: 2026-10-22",
    "- [x] https://jobs.example/closed | Closed Co | Engineer",
    "- [ ] https://jobs.example/role-1 | Duplicate | Duplicate",
    "## Processed",
    "- [ ] https://jobs.example/processed | Processed Co | Role",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "data", "applications.md"), "| # | Company | Role | Status | Report |\n|---|---|---|---|---|\n");
  return root;
}

test("discovery reads only pending, de-duplicates URLs, and uses activation cohort snapshot", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const roles = discoverPipeline(root, { activation: { at: "2026-10-22T10:00:00Z", backlogUrls: ["https://jobs.example/role-1"] } });
  assert.equal(roles.length, 1);
  assert.equal(roles[0].type, "role_packet");
  assert.equal(roles[0].cohort, "backlog");
  assert.equal(roles[0].payload.role, "Support Engineer");
  assert.equal(roles[0].payload.location, "Remote");
  assert.equal(roles[0].payload.postedAt, "2026-10-22");
  assert.equal(discoverPipeline(root, { activation: { at: "2020-01-01", backlogUrls: [] } })[0].cohort, "new");
});

test("preflight fingerprints profile changes and blocks missing inputs", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = discoverPipeline(root)[0];
  const first = pipelinePreflight(root, task);
  assert.equal(first.ok, true);
  fs.appendFileSync(path.join(root, "config", "profile.yml"), "# changed\n");
  const second = pipelinePreflight(root, task);
  assert.equal(second.ok, true);
  assert.notEqual(first.inputFingerprint, second.inputFingerprint);
  fs.rmSync(path.join(root, "cv.md"));
  assert.equal(pipelinePreflight(root, task).ok, false);
});

test("preflight fingerprint includes primary facts and bounded writing inputs", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "article-digest.md"), "Primary evidence.\n");
  fs.mkdirSync(path.join(root, "writing-samples"));
  fs.writeFileSync(path.join(root, "writing-samples", "sample.md"), "Style sample.\n");
  fs.mkdirSync(path.join(root, "interview-prep"));
  fs.writeFileSync(path.join(root, "interview-prep", "story-bank.md"), "Story bank.\n");
  const task = discoverPipeline(root)[0];
  const first = pipelinePreflight(root, task);
  fs.appendFileSync(path.join(root, "article-digest.md"), "Changed source fact.\n");
  const second = pipelinePreflight(root, task);
  assert.notEqual(first.inputFingerprint, second.inputFingerprint);
  fs.writeFileSync(path.join(root, "article-digest.md"), "Primary evidence.\n");
  fs.appendFileSync(path.join(root, "writing-samples", "sample.md"), "Changed sample.\n");
  assert.notEqual(first.inputFingerprint, pipelinePreflight(root, task).inputFingerprint);
});

test("worker preflight reuses saved title, location, and company blacklist gates", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = discoverPipeline(root)[0];
  fs.writeFileSync(path.join(root, "portals.yml"), [
    "title_filter:",
    "  positive: [Support]",
    "location_filter:",
    "  allow: [Remote]",
  ].join("\n"));
  const options = { checkLogin: false, checkLiveness: async () => ({ result: "active" }) };
  assert.equal((await pipelinePreflightWithGates(root, task, options)).ok, true);
  const wrongTitle = await pipelinePreflightWithGates(root, { ...task, payload: { ...task.payload, role: "Accountant" } }, options);
  assert.equal(wrongTitle.ok, false);
  assert.match(wrongTitle.reason, /title filters/);
  const wrongLocation = await pipelinePreflightWithGates(root, { ...task, payload: { ...task.payload, location: "Hyderabad, India" } }, options);
  assert.equal(wrongLocation.ok, false);
  assert.match(wrongLocation.reason, /location filter/);
  fs.writeFileSync(path.join(root, "data", "blacklist.md"), "| Company | Since | Scope | Reason |\n|---|---|---|---|\n| Acme | 2026-01-01 | company | User opted out |\n");
  const blacklisted = await pipelinePreflightWithGates(root, task, options);
  assert.equal(blacklisted.ok, false);
  assert.match(blacklisted.reason, /do-not-apply list/);
});

test("worker preflight blocks liveness that is uncertain or unavailable", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = discoverPipeline(root)[0];
  for (const checkLiveness of [async () => ({ result: "uncertain" }), async () => null]) {
    const result = await pipelinePreflightWithGates(root, task, { checkLogin: false, checkLiveness });
    assert.equal(result.ok, false);
    assert.match(result.requiredAction, /Verify the posting is (?:still )?open(?: in the browser)?/);
  }
});

test("worker preflight uses the extension liveness rung when the ATS API is inconclusive", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = discoverPipeline(root)[0];
  let browserCalls = 0;
  for (const apiResult of [null, { result: "uncertain", code: "api_inconclusive" }]) {
    const result = await pipelinePreflightWithGates(root, task, {
      checkLogin: false,
      checkLivenessApi: async () => apiResult,
      checkBrowserLiveness: async () => { browserCalls += 1; return { result: "active", code: "apply_control_visible" }; },
    });
    assert.equal(result.ok, true);
  }
  assert.equal(browserCalls, 2);
});

test("root preflight accepts a staged report after evaluation moved its URL out of Pending", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = discoverPipeline(root)[0];
  fs.writeFileSync(path.join(root, "data", "pipeline.md"), "# Pipeline\n\n## Pending\n\n## Processed\n- [x] https://jobs.example/role-1\n");
  fs.writeFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), "**URL:** https://jobs.example/role-1\n**Score:** 3/5\n");
  const resumed = await pipelinePreflightWithGates(root, { ...task, checkpoint: { reportNum: "001" } }, {
    checkLogin: false,
    checkLiveness: async () => ({ result: "active" }),
  });
  assert.equal(resumed.ok, true);
});

test("evaluation writes are verified and a replay resumes from its report without duplicating it", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = discoverPipeline(root)[0];
  fs.mkdirSync(path.join(root, "interview-prep"));
  let runs = 0;
  const run = async (_root, prompt, options) => {
    runs += 1;
    assert.match(prompt, /modes\/oferta\.md/);
    assert.match(prompt, /English/);
    assert.deepEqual(options.capabilities, { writes: true, network: "fetch" });
    fs.writeFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), [
      "**URL:** https://jobs.example/role-1",
      "**Score:** 2/5",
      "## Verdict",
      "Hold.",
    ].join("\n"));
    fs.appendFileSync(path.join(root, "data", "applications.md"), "| 1 | Acme | Support Engineer | Review | [Report](reports/001-acme-2026-10-23.md) | [Job](https://jobs.example/role-1) |\n");
    fs.writeFileSync(path.join(root, "interview-prep", "story-bank.md"), "Evaluation-generated derived story.\n");
    return { exitCode: 0, text: "report written" };
  };
  const events = [];
  const first = await executeRole(root, task, { run, onEvent: (event) => events.push(event) });
  assert.equal(first.state, "review_ready");
  assert.equal(first.aiStarted, true);
  assert.equal(first.result.cvSkippedBelowThreshold, 3);
  assert.equal(runs, 1);
  assert.ok(events.some((event) => event.type === "checkpoint" && event.checkpoint.inputFingerprint));
  const filesBefore = fs.readdirSync(path.join(root, "reports"));
  const replay = await executeRole(root, { ...task, checkpoint: first.checkpoint }, { run });
  assert.equal(replay.state, "review_ready");
  assert.equal(replay.aiStarted, false);
  assert.equal(runs, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, "reports")), filesBefore);
});

test("stale checkpoint is blocked before any model call", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = discoverPipeline(root)[0];
  let called = false;
  const result = await executeRole(root, { ...task, checkpoint: { inputFingerprint: "stale" } }, {
    run: async () => { called = true; return { exitCode: 0, text: "" }; },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.aiStarted, false);
  assert.equal(called, false);
});

test("failed AI-start persistence returns aiStarted false and never enters the model runner", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const task = discoverPipeline(root)[0];
  let called = false;
  const result = await executeRole(root, task, {
    beforeAiStart: async (stage) => {
      assert.equal(stage, "evaluation");
      throw new Error("private storage detail must not escape");
    },
    run: async () => { called = true; return { exitCode: 0, text: "" }; },
  });
  assert.equal(result.state, "failed");
  assert.equal(result.aiStarted, false);
  assert.match(result.reason, /no model call was made/);
  assert.doesNotMatch(result.reason, /private storage detail/);
  assert.equal(called, false);
});

test("a primary-fact change blocks a staged role before reusing its report or document", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "article-digest.md"), "Original fact.\n");
  const task = discoverPipeline(root)[0];
  const fingerprint = pipelinePreflight(root, task).inputFingerprint;
  fs.writeFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), "**URL:** https://jobs.example/role-1\n**Score:** 4/5\n");
  fs.appendFileSync(path.join(root, "data", "applications.md"), "| 1 | Acme | Support Engineer | Review | [Report](reports/001-acme-2026-10-23.md) | [Job](https://jobs.example/role-1) |\n");
  fs.appendFileSync(path.join(root, "article-digest.md"), "New primary fact.\n");
  let called = false;
  const result = await executeRole(root, { ...task, checkpoint: { inputFingerprint: fingerprint, reportNum: "001", stage: "documents" } }, {
    run: async () => { called = true; return { exitCode: 0, text: "" }; },
  });
  assert.equal(result.state, "blocked");
  assert.equal(called, false);
  assert.match(result.requiredAction, /retry/);
});

test("configured html output uses the HTML-to-PDF pipeline and verifies the final PDF", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "candidate:\n  full_name: Candidate Example\ncv:\n  output_format: html\nauto_pdf_score_threshold: 3\n");
  const task = discoverPipeline(root)[0];
  let calls = 0;
  const aiOrder = [];
  const run = async (_root, prompt) => {
    calls += 1;
    aiOrder.push(`run:${calls}`);
    if (calls === 1) {
      fs.writeFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), "**URL:** https://jobs.example/role-1\n**Score:** 3/5\n## Keywords extracted\nSupport\n");
      fs.appendFileSync(path.join(root, "data", "applications.md"), "| 1 | Acme | Support Engineer | Review | [Report](reports/001-acme-2026-10-23.md) | [Job](https://jobs.example/role-1) |\n");
      return { exitCode: 0, text: "report written" };
    }
    assert.match(prompt, /<<cv-html format=/);
    return { exitCode: 0, text: '<<cv-html format="letter">>\n<!doctype html><html><body>Candidate CV</body></html>\n<</cv-html>>' };
  };
  let rendered = false;
  const result = await executeRole(root, task, {
    run,
    beforeAiStart: async (stage) => { aiOrder.push(`hook:${stage}`); },
    render: async ({ pdfPaths }) => {
      rendered = true;
      fs.writeFileSync(pdfPaths.finalPdf, "%PDF-fixture");
      return { kind: "rendered" };
    },
  });
  assert.equal(result.state, "review_ready");
  assert.deepEqual(aiOrder, ["hook:evaluation", "run:1", "hook:cv", "run:2"]);
  assert.equal(rendered, true);
  assert.match(result.result.cvReceipt, /\.pdf$/);
  assert.equal(fs.readFileSync(path.join(root, result.result.cvReceipt), "utf8"), "%PDF-fixture");
});

test("explicit fresh-revision retry preserves the old report and requires a new report receipt", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "candidate:\n  full_name: Candidate Example\ncv:\n  output_format: html\nauto_pdf_score_threshold: 3\n");
  const task = discoverPipeline(root)[0];
  fs.writeFileSync(path.join(root, "reports", "001-acme-2026-10-22.md"), "**URL:** https://jobs.example/role-1\n**Score:** 2/5\n");
  const oldPdf = path.join(root, "output", "cv-candidate-example-acme-2026-10-23.pdf");
  fs.writeFileSync(oldPdf, "%PDF-old");
  let calls = 0;
  const run = async (_root, prompt) => {
    calls += 1;
    if (calls === 1) {
      fs.writeFileSync(path.join(root, "reports", "002-acme-2026-10-23.md"), "**URL:** https://jobs.example/role-1\n**Score:** 3/5\n");
      fs.appendFileSync(path.join(root, "data", "applications.md"), "| 1 | Acme | Support Engineer | Review | [Report](reports/002-acme-2026-10-23.md) | [Job](https://jobs.example/role-1) |\n");
      return { exitCode: 0, text: "new revision saved" };
    }
    assert.match(prompt, /<<cv-html format=/);
    return { exitCode: 0, text: '<<cv-html format="letter">>\n<!doctype html><html><body>New revision CV</body></html>\n<</cv-html>>' };
  };
  const result = await executeRole(root, { ...task, forceReevaluation: true, supersedesReportNum: "001" }, {
    run,
    render: async ({ pdfPaths }) => { fs.writeFileSync(pdfPaths.finalPdf, "%PDF-new"); return { kind: "rendered" }; },
  });
  assert.equal(result.state, "review_ready");
  assert.equal(result.result.reportNum, "002");
  assert.equal(result.checkpoint.supersedesReportNum, "001");
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(oldPdf, "utf8"), "%PDF-old");
  assert.match(result.result.cvReceipt, /-r002\.pdf$/);
  assert.equal(fs.readFileSync(path.join(root, result.result.cvReceipt), "utf8"), "%PDF-new");
  assert.match(fs.readFileSync(path.join(root, "reports", "001-acme-2026-10-22.md"), "utf8"), /Score:\*\* 2\/5/);
});

test("high-scoring reports receive missing draft answers from the baseline mode before thresholded CV generation", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "candidate:\n  full_name: Candidate Example\ncv:\n  output_format: text\nauto_pdf_score_threshold: 5\n");
  const task = discoverPipeline(root)[0];
  const calls = [];
  const aiOrder = [];
  const run = async (_root, prompt, options) => {
    calls.push({ prompt, capabilities: options.capabilities });
    aiOrder.push(`run:${calls.length === 1 ? "evaluation" : "answers"}`);
    if (calls.length === 1) {
      fs.writeFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), [
        "**URL:** https://jobs.example/role-1",
        "**Score:** 4.5/5",
        "## Verdict",
        "Proceed.",
        "## Keywords extracted",
        "Support, incident response",
        "## Job Description (archived verbatim)",
        "What is your experience with incidents?",
      ].join("\n"));
      fs.appendFileSync(path.join(root, "data", "applications.md"), "| 1 | Acme | Support Engineer | Evaluated | [Report](reports/001-acme-2026-10-23.md) | [Job](https://jobs.example/role-1) |\n");
      return { exitCode: 0, text: "report written" };
    }
    assert.match(prompt, /Draft Application Answers/);
    assert.deepEqual(options.capabilities, { writes: false, network: false });
    return { exitCode: 0, text: "<<application-answers>>\n**How do you handle incidents?**\nI coordinate incident response using documented procedures.\n<</application-answers>>" };
  };
  const result = await executeRole(root, task, { run, beforeAiStart: async (stage) => { aiOrder.push(`hook:${stage}`); } });
  assert.equal(result.state, "review_ready");
  assert.equal(result.aiStarted, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(aiOrder, ["hook:evaluation", "run:evaluation", "hook:answers", "run:answers"]);
  assert.equal(result.result.cvSkippedBelowThreshold, 5);
  const report = fs.readFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), "utf8");
  assert.match(report, /## H\) Draft Application Answers/);
  assert.match(report, /I coordinate incident response/);
  assert.ok(report.indexOf("## H)") < report.indexOf("## Keywords extracted"));
  assert.ok(result.checkpoint.answerReceipt);
});

test("primary profile changes during application-answer generation block report persistence", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "candidate:\n  full_name: Candidate Example\ncv:\n  output_format: text\nauto_pdf_score_threshold: 5\n");
  const task = discoverPipeline(root)[0];
  let calls = 0;
  const run = async () => {
    calls += 1;
    if (calls === 1) {
      fs.writeFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), [
        "**URL:** https://jobs.example/role-1", "**Score:** 4.5/5", "## Verdict", "Proceed.",
        "## Keywords extracted", "Support", "## Job Description (archived verbatim)", "Question?",
      ].join("\n"));
      fs.appendFileSync(path.join(root, "data", "applications.md"), "| 1 | Acme | Support Engineer | Evaluated | [Report](reports/001-acme-2026-10-23.md) | [Job](https://jobs.example/role-1) |\n");
      return { exitCode: 0, text: "report written" };
    }
    fs.appendFileSync(path.join(root, "config", "profile.yml"), "# edited during answer generation\n");
    return { exitCode: 0, text: "<<application-answers>>\n**Question?**\nDraft answer.\n<</application-answers>>" };
  };
  const result = await executeRole(root, task, { run });
  assert.equal(result.state, "blocked");
  assert.equal(result.aiStarted, true);
  assert.match(result.reason, /changed while application-answer drafting was running/);
  assert.equal(calls, 2);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), "utf8"), /## H\) Draft Application Answers/);
  assert.equal(result.checkpoint.reportNum, "001");
});

test("primary fact changes during CV generation block before a fresh CV write", async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "config", "profile.yml"), "candidate:\n  full_name: Candidate Example\ncv:\n  output_format: html\nauto_pdf_score_threshold: 3\n");
  const task = discoverPipeline(root)[0];
  let calls = 0;
  const run = async () => {
    calls += 1;
    if (calls === 1) {
      fs.writeFileSync(path.join(root, "reports", "001-acme-2026-10-23.md"), "**URL:** https://jobs.example/role-1\n**Score:** 3/5\n## Keywords extracted\nSupport\n");
      fs.appendFileSync(path.join(root, "data", "applications.md"), "| 1 | Acme | Support Engineer | Review | [Report](reports/001-acme-2026-10-23.md) | [Job](https://jobs.example/role-1) |\n");
      return { exitCode: 0, text: "report written" };
    }
    fs.writeFileSync(path.join(root, "article-digest.md"), "New primary fact during CV generation.\n");
    return { exitCode: 0, text: '<<cv-html format="letter">>\n<!doctype html><html><body>CV</body></html>\n<</cv-html>>' };
  };
  let wroteHtml = false;
  const result = await executeRole(root, task, {
    run,
    writeHtml: () => { wroteHtml = true; return { ok: true }; },
    render: async () => ({ kind: "rendered" }),
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.aiStarted, true);
  assert.match(result.reason, /changed while CV generation was running/);
  assert.equal(calls, 2);
  assert.equal(wroteHtml, false);
  assert.equal(result.checkpoint.reportNum, "001");
});
