// Shared by Config, the search request, and the server's CLI launch boundary.
// Empty strings explicitly mean "CLI default"; overrides are stored per CLI.
export const AI_SEARCH_CONTROLS = {
  codex: { effortFlag: "config", efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] },
  claude: { effortFlag: "--effort", efforts: ["low", "medium", "high", "xhigh", "max"] },
  opencode: { effortFlag: "--variant", efforts: null },
  pi: { effortFlag: "--thinking", efforts: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
  copilot: { effortFlag: "--reasoning-effort", efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  grok: { effortFlag: "--reasoning-effort", efforts: null },
  hermes: { effortFlag: "--reasoning", efforts: ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] },
  antigravity: { effortFlag: "--effort", efforts: ["low", "medium", "high", "xhigh", "max"] },
};

export function aiSearchControls(cliId) {
  return Object.hasOwn(AI_SEARCH_CONTROLS, cliId) ? AI_SEARCH_CONTROLS[cliId] : null;
}

/** @param {string} cliId @param {unknown} value */
export function parseAiSearchSettings(cliId, value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AI search settings.");
  const model = value.model ?? "";
  const reasoningEffort = value.reasoningEffort ?? "";
  if (typeof model !== "string" || typeof reasoningEffort !== "string") throw new Error("Model and reasoning effort must be text.");
  const settings = { model: model.trim(), reasoningEffort: reasoningEffort.trim() };
  if (settings.model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(settings.model)) throw new Error("Enter a model ID or alias, without spaces or command-line flags.");
  if (settings.reasoningEffort && !/^[a-z][a-z0-9_-]{0,39}$/.test(settings.reasoningEffort)) throw new Error("Invalid reasoning effort.");
  const controls = aiSearchControls(cliId);
  if (!controls && (settings.model || settings.reasoningEffort)) throw new Error(`Model overrides are not supported for ${cliId} yet.`);
  if (settings.reasoningEffort && controls?.efforts && !controls.efforts.includes(settings.reasoningEffort)) throw new Error(`Unsupported reasoning effort for ${cliId}: ${settings.reasoningEffort}`);
  return settings;
}

export function savedAiSearchSettings(config, cliId) {
  return parseAiSearchSettings(cliId, config?.aiSearch?.[cliId] ?? {});
}

export function aiSearchModelArgs(cliId, value) {
  const { model, reasoningEffort } = parseAiSearchSettings(cliId, value);
  const args = model ? ["--model", model] : [];
  if (reasoningEffort) {
    const flag = aiSearchControls(cliId).effortFlag;
    args.push(...(flag === "config"
      ? ["-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`]
      : [flag, reasoningEffort]));
  }
  return args;
}

export function aiSearchSettingsLabel(cliId, value) {
  const { model, reasoningEffort } = parseAiSearchSettings(cliId, value);
  return `Model: ${model || "CLI default (not pinned)"} · Reasoning: ${reasoningEffort || "CLI default (not pinned)"}`;
}

// Only return catalog fields useful to the picker, never model instructions.
export function codexModelOptions(catalog) {
  if (!Array.isArray(catalog?.models)) throw new Error("Codex returned an invalid model catalog.");
  return catalog.models.filter((m) => m.visibility === "list" && typeof m.slug === "string").map((m) => ({
    id: m.slug,
    name: typeof m.display_name === "string" ? m.display_name : m.slug,
    efforts: (m.supported_reasoning_levels ?? []).map((level) => level.effort).filter((effort) => typeof effort === "string"),
  }));
}
