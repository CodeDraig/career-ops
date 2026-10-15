"use client";

import { useEffect, useState } from "react";
import { aiSearchControls } from "@/lib/ai-search-settings.mjs";

export type AiSearchSettings = { model: string; reasoningEffort: string };
type ModelOption = { id: string; name: string; efforts: string[] };
const fieldClass = "w-full rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-sm";

export function AiSearchModelSettings({ cliId, value, onChange }: {
  cliId: string;
  value: AiSearchSettings;
  onChange: (value: AiSearchSettings) => void;
}) {
  const controls = aiSearchControls(cliId);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [catalogNotice, setCatalogNotice] = useState("");

  useEffect(() => {
    if (cliId !== "codex") return;
    const controller = new AbortController();
    setCatalogNotice("Loading installed Codex model list…");
    fetch("/api/clis/models", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        setModels(Array.isArray(data.models) ? data.models : []);
        setCatalogNotice(data.error || "Suggestions come from the installed Codex catalog; account availability may differ.");
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogNotice("Model list unavailable. Enter a model ID manually.");
      });
    return () => controller.abort();
  }, [cliId]);

  const knownModel = cliId === "codex" ? models.find((m) => m.id === value.model.trim()) : undefined;
  return (
    <section className="mt-6 space-y-3 rounded-xl border border-border p-4" aria-labelledby="ai-search-model-heading">
      <h2 id="ai-search-model-heading" className="text-sm font-semibold">AI search model</h2>
      <p className="text-xs text-muted">Saved separately for each AI tool. These choices apply to new AI searches.</p>
      {!controls ? (
        <p className="text-sm text-muted">Model and reasoning overrides are not available here for this CLI yet. Its own defaults apply.</p>
      ) : (
        <>
          <div>
            <label htmlFor="ai-search-model" className="mb-1 block text-sm">Model ID or alias</label>
            <input id="ai-search-model" list="ai-search-model-options" className={fieldClass}
              value={value.model} placeholder="CLI default (not pinned)" autoComplete="off" maxLength={200}
              onChange={(e) => onChange({ ...value, model: e.target.value })} />
            <datalist id="ai-search-model-options">
              {cliId === "codex" && models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              {cliId === "claude" && ["fable", "opus", "sonnet"].map((id) => <option key={id} value={id} />)}
            </datalist>
            <p className="mt-1 text-xs text-muted">{value.model.trim() ? `Requested model: ${value.model.trim()}` : "Model: CLI default — no model is pinned."}</p>
            {cliId === "codex" && <p className="mt-1 text-xs text-muted">{catalogNotice}</p>}
            {cliId === "opencode" && <p className="mt-1 text-xs text-muted">Use provider/model, as shown by OpenCode.</p>}
          </div>
          <div>
            <label htmlFor="ai-search-effort" className="mb-1 block text-sm">
              {cliId === "opencode" ? "Reasoning variant" : "Reasoning effort"}
            </label>
            {controls.efforts ? (
              <select id="ai-search-effort" className={fieldClass} value={value.reasoningEffort}
                onChange={(e) => onChange({ ...value, reasoningEffort: e.target.value })}>
                <option value="">CLI default (not pinned)</option>
                {controls.efforts.map((effort: string) => <option key={effort} value={effort}>{effort}</option>)}
              </select>
            ) : (
              <input id="ai-search-effort" className={fieldClass} value={value.reasoningEffort}
                placeholder="CLI default (not pinned)" maxLength={40}
                onChange={(e) => onChange({ ...value, reasoningEffort: e.target.value })} />
            )}
            <p className="mt-1 text-xs text-muted">
              {knownModel ? `Catalog-supported levels: ${knownModel.efforts.join(", ") || "none listed"}.` : "Supported effort levels depend on the model and provider."}
              {" "}Career-Ops reports CLI failures and does not retry them with a different model.
            </p>
          </div>
          {cliId === "codex" && <p className="text-xs text-muted">Codex AI search ignores your user config. Set both fields here to pin the model and reasoning effort; leaving them at default lets Codex choose.</p>}
        </>
      )}
    </section>
  );
}
