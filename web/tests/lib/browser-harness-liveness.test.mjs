import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { readLivenessInBrowser } from "../../../lib/browser-harness/runner.mjs";

function fakeExecFile(results) {
  const calls = [];
  const execute = (bin, args, options, callback) => {
    calls.push({ bin, args, options });
    const child = new EventEmitter();
    child.stdin = {
      on() { return this; },
      end(source) {
        calls.at(-1).source = source;
        const result = results.shift();
        queueMicrotask(() => callback(null, result));
      },
    };
    return child;
  };
  return { execute, calls };
}

test("extension liveness uses task-owned tabs and closes only a confirmed result", async () => {
  const { execute, calls } = fakeExecFile([
    `CAREER_OPS_LIVENESS={"status":"page","url":"https://jobs.example.test/role","targetId":"task-tab","title":"Support Engineer","text":"${"x".repeat(350)}","controls":["Apply Now"]}`,
    "",
  ]);
  const result = await readLivenessInBrowser("https://jobs.example.test/role", {
    env: { CAREER_OPS_BROWSER_HARNESS_BIN: "fake-browser-harness" }, execute,
  });
  assert.equal(result.result, "active");
  assert.equal(calls.length, 2);
  assert.match(calls[0].source, /target = new_tab\(requested\)/);
  assert.doesNotMatch(calls[0].source, /new_tab\(['"]about:blank['"]\)/);
  assert.doesNotMatch(calls[0].source, /goto_url\(requested\)/);
  assert.match(calls[0].source, /caps\.get\('backend'\) != 'extension'/);
  assert.doesNotMatch(calls[0].source, /\bjs\(|cdp\(/);
  assert.match(calls[1].source, /current\.get\('targetId'\) == request\['targetId'\]/);
});

test("liveness extension path satisfies the HTTP-only new_tab contract", async () => {
  const { execute, calls } = fakeExecFile([
    `CAREER_OPS_LIVENESS={"status":"page","url":"https://jobs.example.test/role","targetId":"fresh-tab","title":"","text":"${"x".repeat(350)}","controls":[]}`,
  ]);
  const result = await readLivenessInBrowser("https://jobs.example.test/role", {
    env: { CAREER_OPS_BROWSER_HARNESS_BIN: "fake-browser-harness" },
    execute: (bin, args, options, callback) => {
      const child = execute(bin, args, options, (error, stdout) => {
        if (!error) {
          const call = calls.at(-1).source.match(/target = new_tab\(([^)]+)\)/);
          const url = call?.[1] === "requested" ? "https://jobs.example.test/role" : call?.[1]?.replace(/^['"]|['"]$/g, "");
          if (!/^https?:\/\//.test(url || "")) {
            callback(new Error("restricted_url: supply http(s) URL"), "");
            return;
          }
        }
        callback(error, stdout);
      });
      return child;
    },
  });
  assert.equal(result.result, "uncertain");
  assert.equal(calls.length, 1);
  assert.match(calls[0].source, /target = new_tab\(requested\)/);
  assert.doesNotMatch(calls[0].source, /about:blank/);
});

test("uncertain extension liveness leaves the task tab for review", async () => {
  const { execute, calls } = fakeExecFile([
    `CAREER_OPS_LIVENESS={"status":"page","url":"https://jobs.example.test/role","targetId":"task-tab","title":"Support Engineer","text":"${"x".repeat(350)}","controls":[]}`,
  ]);
  const result = await readLivenessInBrowser("https://jobs.example.test/role", {
    env: { CAREER_OPS_BROWSER_HARNESS_BIN: "fake-browser-harness" }, execute,
  });
  assert.equal(result.result, "uncertain");
  assert.equal(calls.length, 1);
});
