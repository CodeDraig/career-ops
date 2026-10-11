import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";

// Stub only external CLI execution. Exercise the real loop and its terminal
// decision, with no model calls, credentials or browser submission.
const mocks = {
  "@/lib/clis": 'export const resolveCli = () => ({ binPath: "fixture" });',
  "@/lib/spawn-cli.mjs": `
    import { EventEmitter } from "node:events";
    export function spawnHeadlessCli() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(process.env.CO_DRIVE_FIXTURE_ACTION || "unparseable planner response"));
        child.emit("close", 0);
      });
      return child;
    }
  `,
};
register(`data:text/javascript,${encodeURIComponent(`
  const mocks = ${JSON.stringify(mocks)};
  export async function resolve(specifier, context, nextResolve) {
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    if (specifier === "./diagnose") return nextResolve(new URL("./diagnose.ts", context.parentURL).href, context);
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { driveSession } = await import("../../src/lib/apply/drive.ts");

const page = {
  context: () => ({ pages: () => [] }),
  frames: () => [],
  mainFrame: () => ({ evaluate: async () => {}, $$: async () => [], $: async () => null }),
  screenshot: async () => Buffer.from("fixture"),
  title: async () => "Fictional form",
  url: () => "http://fixture.invalid",
  waitForTimeout: async () => {},
};

test("full-fill budget exhaustion is incomplete even when the form remains visible", async () => {
  const steps = [];
  const result = await driveSession(page, "claude", "full", async () => true, (step) => steps.push(step), 16);
  assert.equal(result.turns, 16);
  assert.equal(steps.length, 16);
  assert.equal(result.reason, "budget-exhausted");
  assert.equal(result.reached, false);
});

test("reach-form still succeeds as soon as a form is present", async () => {
  const result = await driveSession(page, "claude", "reach", async () => true, () => {}, 7);
  assert.equal(result.reached, true);
  assert.equal(result.turns, 0);
});

test("a reached_form response is not full-fill completion", async () => {
  process.env.CO_DRIVE_FIXTURE_ACTION = '{"action":"reached_form"}';
  try {
    const result = await driveSession(page, "claude", "full", async () => true, () => {}, 1);
    assert.equal(result.reached, false);
  } finally { delete process.env.CO_DRIVE_FIXTURE_ACTION; }
});

test("the full-fill done action still hands off", async () => {
  process.env.CO_DRIVE_FIXTURE_ACTION = '{"action":"done"}';
  try {
    const result = await driveSession(page, "claude", "full", async () => true, () => {}, 1);
    assert.equal(result.reached, true);
    assert.equal(result.reason, "agent-done");
  } finally { delete process.env.CO_DRIVE_FIXTURE_ACTION; }
});
