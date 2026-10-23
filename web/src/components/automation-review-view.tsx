"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { canConfirmApplicationMatch, canRetryTask, sourceReviewDetails } from "@/lib/automation-review-presentation.mjs";

type AutomationConfig = {
  enabled: boolean; paused: boolean; timezone: string;
  dailyRoles: number; dailyDrafts: number; newSlots: number; backlogSlots: number;
  mailAccounts: string[]; model: string; effort: string;
};
type ReviewItem = { id: string; type: string; title: string; payload: Record<string, unknown>; taskId?: string | null; state: string; revision: number };
type Status = {
  config: AutomationConfig; day: string;
  worker?: { healthy?: boolean; at?: string; pid?: number; [key: string]: unknown };
  activation?: unknown; budgets: { roles: { used: number; limit: number }; drafts: { used: number; limit: number }; cohorts: { new: number; backlog: number } };
  blockers: Array<{ code?: string; message: string; requiredAction?: string; taskId?: string }>;
  digests?: Array<{ day?: string; at?: string; counts?: Record<string, number>; reviewIds?: string[]; sourceFailures?: Array<{ taskId: string; reason: string }> }>;
};
type MailAccount = { id: string; from?: string; imap?: boolean; smtp?: boolean; ready?: string[] };

const inputClass = "w-full rounded border border-border bg-background p-2";
const buttonClass = "rounded border border-border px-3 py-2 disabled:opacity-40";
function SourceRepairDetails({ payload }: { payload: Record<string, unknown> }) {
  const rows = sourceReviewDetails(payload);
  return <details className="rounded bg-muted/30 p-3">
    <summary className="cursor-pointer">Source and attempt details</summary>
    <dl className="mt-2 space-y-1 text-sm">
      {rows.map(([key, value], index) => <div key={`${key}-${index}`}><dt className="inline font-medium">{key}: </dt><dd className="inline break-words">{value}</dd></div>)}
    </dl>
  </details>;
}

async function responseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`) as Error & { status?: number; current?: unknown };
    error.status = response.status; error.current = data.current;
    throw error;
  }
  return data;
}

export function AutomationReviewView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [draft, setDraft] = useState<AutomationConfig | null>(null);
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [answerById, setAnswerById] = useState<Record<string, string>>({});
  const [matchById, setMatchById] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [nextStatus, nextReviews, mail] = await Promise.all([
      fetch("/api/automation", { cache: "no-store" }).then(responseJson),
      fetch(`/api/automation/review?state=${encodeURIComponent(filter)}`, { cache: "no-store" }).then(responseJson),
      fetch("/api/mail", { cache: "no-store" }).then(responseJson).catch(() => ({ accounts: [] })),
    ]);
    setStatus(nextStatus); setDraft(nextStatus.config); setItems(Array.isArray(nextReviews) ? nextReviews : nextReviews.reviews || nextReviews.items || []); setAccounts(mail.accounts || []);
  }, [filter]);

  useEffect(() => { void load().catch(error => setNotice(error instanceof Error ? error.message : "Automation data unavailable.")); }, [load]);

  async function perform(work: () => Promise<void>) {
    setBusy(true); setNotice("");
    try { await work(); }
    catch (error) {
      const e = error as Error & { status?: number };
      if (e.status === 409) {
        setNotice("This item changed while you were reviewing it. The inbox has been reloaded; check the current details before acting again.");
        await load().catch(() => undefined);
      } else setNotice(e.message || "Automation request failed.");
    } finally { setBusy(false); }
  }

  async function saveConfig(patch: Partial<AutomationConfig>) {
    if (!draft) return;
    const updated = { ...draft, ...patch };
    await responseJson(await fetch("/api/automation/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) }));
    await load(); setNotice("Automation settings saved.");
  }

  async function act(item: ReviewItem, action: string, fields: Record<string, unknown> = {}) {
    const data = await responseJson(await fetch(`/api/automation/review/${encodeURIComponent(item.id)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, expectedRevision: item.revision, ...fields }),
    }));
    if (action === "open_draft") {
      const seed = data.result;
      if (!seed || typeof seed !== "object") throw new Error("Automation draft could not be opened.");
      sessionStorage.setItem("careerOpsAutomationMailDraft", JSON.stringify(seed));
      window.location.assign("/mail?automationDraft=1");
      return;
    }
    await load(); setNotice("Review action saved.");
  }

  if (!draft) return <main className="mx-auto max-w-5xl space-y-4 p-6"><h1 className="text-2xl font-semibold">Automation inbox</h1><p role="status">{notice || "Loading automation status…"}</p></main>;

  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Automation inbox</h1><p>Review prepared job packets, mail drafts, application matches, status suggestions, and search failures.</p><p role="status" className="whitespace-pre-wrap">{notice}</p></header>

    <section className="space-y-4 rounded border border-border p-4" aria-labelledby="automation-status-heading">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="automation-status-heading" className="text-xl">Instance status</h2><p>{status?.worker?.healthy ? `Worker active · last heartbeat ${status.worker.at || "recently"}` : "Worker has not reported a recent heartbeat."}</p></div>
        <span className="rounded bg-muted px-2 py-1 text-sm">{status?.config.enabled ? status.config.paused ? "Paused" : "Enabled" : "Disabled"}</span></div>
      {status?.blockers?.length ? <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3"><h3 className="font-medium">Setup or task blockers</h3><ul className="list-disc space-y-1 pl-5">{status.blockers.map((blocker, index) => <li key={`${blocker.code || "blocker"}-${index}`}>{blocker.message}{blocker.requiredAction ? ` ${blocker.requiredAction}` : ""}</li>)}</ul><p className="mt-2 flex flex-wrap gap-3"><a className="underline" href="/cv">Set up CV</a><a className="underline" href="/config">Set up profile and searches</a><a className="underline" href="/mail">Set up mail</a></p></div> : null}
      <div className="grid gap-3 sm:grid-cols-3"><p>Roles today: {status?.budgets.roles.used ?? 0}/{status?.budgets.roles.limit ?? draft.dailyRoles}</p><p>Mail drafts today: {status?.budgets.drafts.used ?? 0}/{status?.budgets.drafts.limit ?? draft.dailyDrafts}</p><p>Slots used: {status?.budgets.cohorts.new ?? 0} new · {status?.budgets.cohorts.backlog ?? 0} backlog</p></div>
      <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || draft.enabled} onClick={() => perform(() => saveConfig({ enabled: true, paused: false }))}>Enable automation</button><button className={buttonClass} disabled={busy || !draft.enabled || draft.paused} onClick={() => perform(() => saveConfig({ paused: true }))}>Pause</button><button className={buttonClass} disabled={busy || !draft.enabled || !draft.paused} onClick={() => perform(() => saveConfig({ paused: false }))}>Resume</button><button className={buttonClass} disabled={busy} onClick={() => perform(load)}>Refresh</button></div>
    </section>

    <section className="space-y-4 rounded border border-border p-4"><h2 className="text-xl">Settings</h2><p>Each instance uses its own Codex login and mail credentials. Enabling records the current pending URLs as the backlog boundary.</p>
      <div className="grid gap-3 sm:grid-cols-2"><label>Timezone<input className={inputClass} disabled={busy} value={draft.timezone} onChange={e => setDraft({ ...draft, timezone: e.target.value })} /></label><label>Codex model (blank uses CLI default)<input className={inputClass} disabled={busy} value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
        <label>Reasoning effort<select className={inputClass} disabled={busy} value={draft.effort} onChange={e => setDraft({ ...draft, effort: e.target.value })}>{["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].map(value => <option key={value} value={value}>{value || "CLI default"}</option>)}</select></label>
        <label>Mail accounts<select multiple className={inputClass} disabled={busy} value={draft.mailAccounts} onChange={e => setDraft({ ...draft, mailAccounts: Array.from(e.target.selectedOptions, option => option.value) })}>{accounts.map(item => <option key={item.id} value={item.id}>{item.id} — {item.from || "sender unavailable"} ({item.ready?.join(", ") || "credentials missing"})</option>)}</select></label>
        <label>Daily role limit<input className={inputClass} type="number" min={0} max={20} disabled={busy} value={draft.dailyRoles} onChange={e => setDraft({ ...draft, dailyRoles: Number(e.target.value) })} /></label><label>Daily mail draft limit<input className={inputClass} type="number" min={0} max={20} disabled={busy} value={draft.dailyDrafts} onChange={e => setDraft({ ...draft, dailyDrafts: Number(e.target.value) })} /></label>
        <label>New role slots<input className={inputClass} type="number" min={0} max={20} disabled={busy} value={draft.newSlots} onChange={e => setDraft({ ...draft, newSlots: Number(e.target.value) })} /></label><label>Backlog role slots<input className={inputClass} type="number" min={0} max={20} disabled={busy} value={draft.backlogSlots} onChange={e => setDraft({ ...draft, backlogSlots: Number(e.target.value) })} /></label>
      </div><button className={buttonClass} disabled={busy} onClick={() => perform(() => saveConfig(draft))}>Save settings</button><p className="text-sm text-muted">Daily digest appears here at 8:00 a.m. local time. No outbound notifications are sent.</p>
    </section>

    {status?.digests?.length ? <section className="space-y-3 rounded border border-border p-4"><h2 className="text-xl">Daily digest</h2>{status.digests.slice(0, 3).map((digest, index) => <article key={`${digest.day || digest.at || "digest"}-${index}`} className="rounded bg-muted/40 p-3"><p className="font-medium">{digest.day || digest.at || "Digest"}</p><p>{digest.counts?.completed || 0} completed · {digest.counts?.failed || 0} failed · {digest.counts?.blocked || 0} blocked</p>{digest.sourceFailures?.length ? <p>Search failures: {digest.sourceFailures.length} need attention.</p> : null}</article>)}</section> : null}

    <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl">Review queue</h2><select className="rounded border border-border bg-background p-2" value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Open</option><option value="all">All</option><option value="resolved">Resolved</option></select></div>
      {!items.length && <p className="rounded border border-border p-4 text-muted">No review items in this view.</p>}
      {items.map(item => <article key={item.id} className="space-y-3 rounded border border-border p-4"><div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-medium">{item.title}</h3><p className="text-sm text-muted">{item.type.replaceAll("_", " ")} · {item.state} · revision {item.revision}</p></div><span className="rounded bg-muted px-2 py-1 text-xs">{String(item.payload.classification || item.payload.reason || "Review")}</span></div>
        {item.payload.evidence ? <p className="whitespace-pre-wrap">{String(item.payload.evidence)}</p> : null}
        {item.payload.reason ? <p>{String(item.payload.reason)}</p> : null}
        {item.payload.requiredAction ? <p>{String(item.payload.requiredAction)}</p> : null}
        {item.type === "source_repair" && <SourceRepairDetails payload={item.payload} />}
        {item.type === "job_packet" && item.payload.reportNum != null && <div className="space-y-1"><p>Evaluation score: {item.payload.score == null ? "not reported" : String(item.payload.score)} · tailored CV: {item.payload.cvSkippedBelowThreshold ? "below the configured threshold" : String(item.payload.cvFormat || "ready")}</p><Link className="underline" href={`/pipeline/${encodeURIComponent(String(item.payload.reportNum))}`}>Review evaluation report</Link></div>}
        {typeof item.payload.url === "string" && <a className="block break-all underline" href={item.payload.url} target="_blank" rel="noreferrer">Open source posting</a>}
        {item.type === "mail_status_proposal" && <p>Suggested status: {String(item.payload.from_status)} → {String(item.payload.to_status)} · application #{String((item.payload.application as Record<string, unknown> | undefined)?.num || "?")}</p>}
        {item.type === "mail_match" && <div className="space-y-2"><label className="block text-sm">Confirm application<select className={inputClass} disabled={busy} value={matchById[item.id] || ""} onChange={e => setMatchById({ ...matchById, [item.id]: e.target.value })}><option value="">Choose a suggested application…</option>{((item.payload.suggestions as Array<Record<string, unknown>>) || []).map(candidate => <option key={String(candidate.appNum)} value={String(candidate.appNum)}>#{String(candidate.appNum)} {String(candidate.company || "Application")} {candidate.role ? `— ${String(candidate.role)}` : ""}</option>)}</select></label><label className="block text-sm">Or enter an application number<input className={inputClass} type="number" min={1} step={1} disabled={busy} value={matchById[item.id] || ""} onChange={e => setMatchById({ ...matchById, [item.id]: e.target.value })} /></label><Link className="text-sm underline" href="/pipeline">Find the application in your pipeline</Link></div>}
        {(item.type === "pipeline_input" || item.type === "mail_draft_input" || (item.type === "required_input" && !!item.taskId)) ? <label className="block text-sm">Answer or provide missing input<textarea className={inputClass} rows={3} value={answerById[item.id] || ""} onChange={e => setAnswerById({ ...answerById, [item.id]: e.target.value })} /></label> : null}
        <div className="flex flex-wrap gap-2">
          {item.type === "mail_draft" && <button className={buttonClass} disabled={busy} onClick={() => perform(() => act(item, "open_draft"))}>Open draft in Mail</button>}
          {item.type === "mail_match" && <button className={buttonClass} disabled={busy || !canConfirmApplicationMatch(matchById[item.id])} onClick={() => perform(() => act(item, "match", { appNum: Number(matchById[item.id]) }))}>Confirm match</button>}
          {item.type === "mail_status_proposal" && <button className={buttonClass} disabled={busy} onClick={() => perform(() => act(item, "approve_status"))}>Approve status suggestion</button>}
          {item.taskId && canRetryTask(item.payload) && <button className={buttonClass} disabled={busy} onClick={() => perform(() => act(item, "retry"))}>Retry task</button>}
          {(item.type === "pipeline_input" || item.type === "mail_draft_input" || (item.type === "required_input" && !!item.taskId)) && <button className={buttonClass} disabled={busy || !(answerById[item.id] || "").trim()} onClick={() => perform(() => act(item, "answer", { answer: answerById[item.id] }))}>Submit answer</button>}
          {item.state === "open" && <button className={buttonClass} disabled={busy} onClick={() => perform(() => act(item, "reviewed"))}>Mark reviewed</button>}
          {item.state === "open" && <button className={buttonClass} disabled={busy} onClick={() => perform(() => act(item, "dismiss"))}>Dismiss</button>}
        </div>
      </article>)}
    </section>
  </main>;
}
