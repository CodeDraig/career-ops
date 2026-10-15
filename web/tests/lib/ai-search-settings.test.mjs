import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aiSearchModelArgs, aiSearchSettingsLabel, parseAiSearchSettings,
  savedAiSearchSettings, codexModelOptions,
} from "../../src/lib/ai-search-settings.mjs";
import { fenceArgs } from "../../src/lib/cli-fencing.mjs";
import { CAPS } from "../../src/lib/worker-capabilities.mjs";

test("Codex model and reasoning survive permission fencing as explicit arguments", () => {
  const args = ["exec", "--ignore-user-config", "Find jobs", ...aiSearchModelArgs("codex", { model: "gpt-6.1-sol", reasoningEffort: "high" })];
  const fenced = fenceArgs({ cliId: "codex", args, capabilities: CAPS.webSearchOnly }).args;
  assert.equal(fenced[fenced.indexOf("--model") + 1], "gpt-6.1-sol");
  assert.ok(fenced.includes('model_reasoning_effort="high"'));
  assert.ok(fenced.includes("--ignore-user-config"));
  assert.ok(fenced.includes("sandbox_mode=read-only"));
});

test("each installed CLI receives its own effort flag", () => {
  for (const [cli, flag] of Object.entries({ claude: "--effort", opencode: "--variant", pi: "--thinking", copilot: "--reasoning-effort", grok: "--reasoning-effort", hermes: "--reasoning", antigravity: "--effort" })) {
    assert.deepEqual(aiSearchModelArgs(cli, { model: "provider/model", reasoningEffort: "high" }), ["--model", "provider/model", flag, "high"]);
  }
});

test("per-CLI choices survive JSON storage and switching without leaking across tools", () => {
  const stored = JSON.parse(JSON.stringify({ aiSearch: {
    codex: { model: "gpt-6.1-sol", reasoningEffort: "high" },
    claude: { model: "sonnet", reasoningEffort: "medium" },
  } }));
  assert.deepEqual(savedAiSearchSettings(stored, "codex"), { model: "gpt-6.1-sol", reasoningEffort: "high" });
  assert.deepEqual(savedAiSearchSettings(stored, "claude"), { model: "sonnet", reasoningEffort: "medium" });
  assert.deepEqual(savedAiSearchSettings(stored, "pi"), { model: "", reasoningEffort: "" });
});

test("default is explicit in the label and emits no override; none is a real override", () => {
  assert.deepEqual(aiSearchModelArgs("codex", {}), []);
  assert.match(aiSearchSettingsLabel("codex", {}), /Model: CLI default \(not pinned\).*Reasoning: CLI default \(not pinned\)/);
  assert.deepEqual(aiSearchModelArgs("codex", { reasoningEffort: "none" }), ["-c", 'model_reasoning_effort="none"']);
});

test("malformed settings and unsupported choices fail instead of becoming defaults", () => {
  for (const value of [null, [], "high", { model: 42 }, { reasoningEffort: true }, { model: "--dangerously-bypass-approvals-and-sandbox" }, { model: "x\n--config=y" }, { reasoningEffort: 'high"\nmodel="other' }]) {
    assert.throws(() => parseAiSearchSettings("codex", value));
  }
  assert.throws(() => parseAiSearchSettings("claude", { reasoningEffort: "ultra" }), /Unsupported/);
  assert.throws(() => parseAiSearchSettings("unknown", { model: "model" }), /not supported/);
  assert.throws(() => savedAiSearchSettings({ aiSearch: { codex: { model: 42 } } }, "codex"));
});

test("catalog picker exports model IDs and efforts without embedded instructions", () => {
  assert.deepEqual(codexModelOptions({ models: [
    { slug: "a", visibility: "list", display_name: "A", supported_reasoning_levels: [{ effort: "high" }], model_messages: { secret: "instructions" } },
    { slug: "hidden", visibility: "hide" },
  ] }), [{ id: "a", name: "A", efforts: ["high"] }]);
  assert.throws(() => codexModelOptions({}));
});

test("saved settings are sent by AI search and applied at the route's launch boundary", () => {
  const client = readFileSync(new URL("../../src/components/explore/explore-provider.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../src/app/api/explore/ai/route.ts", import.meta.url), "utf8");
  assert.match(client, /savedAiSearchSettings\(config, cliId\)/);
  assert.match(client, /JSON.stringify\(\{ query: intent, cliId, settings \}\)/);
  assert.match(route, /aiSearchModelArgs\(cliId, settings\)/);
  assert.match(route, /args.push\(\.\.\.modelArgs\)/);
  assert.match(route, /cliId !== requestedCliId && \(settings.model \|\| settings.reasoningEffort\)/);
});
