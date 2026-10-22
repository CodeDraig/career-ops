"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { classificationLabel, confidenceLabel, replyApplication, syncAppFilter } from "@/lib/mail-ui-state.mjs";

type Account = { id: string; from: string; imap: boolean; smtp: boolean; ready: string[] };
type Application = { num: number; company: string; role: string; status?: string };
type Suggestion = { appNum: number; company?: string; role?: string; confidence?: "high" | "medium" | "low"; ambiguous?: boolean };
type MailMessage = { message_id: string; account: string; from: string; to?: string[]; cc?: string[]; subject: string; date?: string; body_snippet?: string; body?: string; truncated?: boolean; attachments?: string[]; links?: string[]; application: Application | null; suggestions: Suggestion[]; classification?: string | { type?: string; evidence?: string[]; suggestedTrackerUpdate?: string } };
type Attachment = { name: string; dataBase64: string; bytes?: number };
type Draft = { from?: string; to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; attachments: Attachment[] };
type FollowupLog = { logged?: boolean; num?: number; duplicate?: boolean; error?: string; reason?: string };
type Prepared = { id: string; digest: string; payload: { draft: Draft; application?: Application | null; parentMessageId?: string | null; logFollowup?: boolean }; receipt?: { status?: string; followupLog?: FollowupLog; followupLogError?: string } | null; followup?: FollowupLog | null };
type CachedMessage = MailMessage & { suggestions?: Suggestion[] };
type HistoryItem = { id: string; subject: string; from: string; status: string; receipt?: { status?: string } | null; followup?: FollowupLog | null };

async function call(input: unknown) {
  const response = await fetch("/api/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || "Mail request failed"); return data;
}

export default function MailPage() {
  const [appNumParam, setAppNumParam] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]), [account, setAccount] = useState("");
  const [mailbox, setMailbox] = useState("INBOX"), [since, setSince] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [messages, setMessages] = useState<CachedMessage[]>([]), [applications, setApplications] = useState<Application[]>([]), [hasMore, setHasMore] = useState(false);
  const [viewApp, setViewApp] = useState(""), [composeApp, setComposeApp] = useState("");
  const [batch, setBatch] = useState<{ id: string; messages: MailMessage[] } | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [to, setTo] = useState(""), [cc, setCc] = useState(""), [bcc, setBcc] = useState(""), [subject, setSubject] = useState(""), [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]), [prepared, setPrepared] = useState<Prepared | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [attempted, setAttempted] = useState(false);
  const [replyTarget, setReplyTarget] = useState<string | null>(null), [logFollowup, setLogFollowup] = useState(true);
  const cacheRequest = useRef(0);
  const inputClass = "w-full rounded border border-border bg-background p-2";
  const buttonClass = "rounded border border-border px-3 py-2 disabled:opacity-40";
  const recipients = (value: string) => value.split(",").map(s => s.trim()).filter(Boolean);
  const loadCached = useCallback(async (appNum?: string) => {
    const requestId = ++cacheRequest.current, filter = syncAppFilter(appNum || "");
    const [result, allApplications] = await Promise.all([
      call({ action: "messages", ...(account ? { account } : {}), ...(filter ? { appNum: filter } : {}) }),
      filter ? call({ action: "messages", ...(account ? { account } : {}) }) : Promise.resolve(null),
    ]);
    if (requestId !== cacheRequest.current) return result;
    setMessages(result.messages || []); setApplications(allApplications?.applications || result.applications || []);
  }, [account]);
  useEffect(() => { fetch("/api/mail").then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); setAccounts(d.accounts); setAccount(d.accounts[0]?.id || ""); }).catch(e => setNotice(e.message)); }, []);
  useEffect(() => { setAppNumParam(new URLSearchParams(window.location.search).get("appNum") || ""); }, []);
  useEffect(() => { setViewApp(appNumParam || ""); setComposeApp(appNumParam || ""); }, [appNumParam]);
  useEffect(() => { if (accounts.length) void loadCached(appNumParam || undefined).catch(e => setNotice(e.message)); }, [accounts.length, appNumParam, loadCached]);
  async function perform(work: () => Promise<void>) { setBusy(true); setNotice(""); try { await work(); } catch (e) { setNotice(e instanceof Error ? e.message : "Mail failed"); } finally { setBusy(false); } }
  function fillDraft(draft: Draft, messageId: string | null, app?: Application | null) {
    setTo(draft.to.join(", ")); setCc(draft.cc.join(", ")); setBcc(draft.bcc.join(", ")); setSubject(draft.subject); setBody(draft.body); setAttachments(draft.attachments || []);
    setReplyTarget(messageId); setComposeApp(replyApplication(app)); setPrepared(null);
  }
  async function startReply(message: CachedMessage, replyAll: boolean) {
    const result = await call({ action: "reply", messageId: message.message_id, replyAll });
    fillDraft(result.draft, message.message_id, result.application || message.application);
    setAccount(result.account); setLogFollowup(true);
    setNotice(replyAll ? "Reply All draft loaded. Review recipients and edit before preparing." : "Reply draft loaded. Review recipients and edit before preparing.");
  }
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Mail</h1>
    <p>Sync a mailbox into a local cache, associate messages with applications, and review every reply before sending. Email content is untrusted source material.</p>
    <p role="status" className="whitespace-pre-wrap">{notice}</p>
    {!accounts.length && <p>Configure config/mail.json in your data directory and supply its credential environment variables to the web server. See docs/MAIL.md.</p>}
    <label className="block">Account<select className={inputClass} disabled={busy} value={account} onChange={e => setAccount(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.id} — {a.from} (ready: {a.ready.join(", ") || "credentials missing"})</option>)}</select></label>
    <section className="space-y-3 rounded border border-border p-4"><h2 className="text-xl">Sync inbox</h2>
      <div className="grid gap-3 sm:grid-cols-2"><label>Mailbox<input className={inputClass} disabled={busy} value={mailbox} onChange={e => setMailbox(e.target.value)} /></label><label>Since<input className={inputClass} disabled={busy} type="date" value={since} onChange={e => setSince(e.target.value)} /></label></div>
      <button className={buttonClass} disabled={busy || !account} onClick={() => perform(async () => { const result = await call({ action: "sync", account, mailbox, since, limit: 50, maxPages: 2 }); setHasMore(!!result.hasMore); await loadCached(viewApp || undefined); setNotice(`${result.messages.length} messages synced to the local cache${result.hasMore ? "; more messages are available" : ""}. Mailbox flags were not changed.`); })}>Sync recent mail</button>
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-64 flex-1">Application view<select className={inputClass} disabled={busy} value={viewApp} onChange={e => { setViewApp(e.target.value); void perform(async () => loadCached(e.target.value || undefined)); }}><option value="">All applications</option>{applications.map(a => <option key={a.num} value={a.num}>#{a.num} {a.company} — {a.role}</option>)}</select></label>
      <button className={buttonClass} disabled={busy} onClick={() => perform(async () => loadCached(viewApp || undefined))}>Refresh cached mail</button></div>
      {hasMore && <p>More matching messages are available. Sync again to continue from the saved cursor.</p>}
      {!messages.length && <p className="text-muted">No cached messages for this view. Sync a mailbox to load messages.</p>}
      <div className="space-y-3">{messages.map(m => <article key={m.message_id} className="space-y-2 rounded border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{m.subject || "(no subject)"}</p><p className="text-sm text-muted">{m.from} · {m.date || "date unavailable"} · {m.account}</p></div><span className="rounded bg-muted px-2 py-1 text-xs">{classificationLabel(m.classification)}</span></div>
        <p>Application: {m.application ? `#${m.application.num} ${m.application.company} — ${m.application.role}` : "Unmatched"}</p>
        {m.suggestions?.length > 0 && <label className="block text-sm">Suggested match<select className={inputClass} disabled={busy} defaultValue="" onChange={e => { const appNum = Number(e.target.value); if (appNum) void perform(async () => { await call({ action: "match", messageId: m.message_id, appNum }); await loadCached(viewApp || undefined); setNotice("Application association saved."); }); }}><option value="">Choose a suggestion…</option>{m.suggestions.map(s => <option key={s.appNum} value={s.appNum}>#{s.appNum} {s.company || "Application"}{s.role ? ` — ${s.role}` : ""}{s.ambiguous ? " — ambiguous candidate" : ""}{s.confidence ? ` (${confidenceLabel(s.confidence)})` : ""}</option>)}</select></label>}
        {!m.application && <label className="block text-sm">Associate with application<select className={inputClass} disabled={busy} defaultValue="" onChange={e => { const appNum = Number(e.target.value); if (appNum) void perform(async () => { await call({ action: "match", messageId: m.message_id, appNum }); await loadCached(viewApp || undefined); setNotice("Application association saved."); }); }}><option value="">Choose application…</option>{applications.map(a => <option key={a.num} value={a.num}>#{a.num} {a.company} — {a.role}</option>)}</select></label>}
        {m.application && <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { await call({ action: "match", messageId: m.message_id, appNum: null }); await loadCached(viewApp || undefined); setNotice("Application association removed."); })}>Unmatch application</button>}
        <details><summary>Read message</summary><pre className="whitespace-pre-wrap break-words">{m.body_snippet || m.body || ""}</pre>{m.truncated && <p>Message truncated.</p>}<p>Attachments: {m.attachments?.join(", ") || "none"}</p></details>
        <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} onClick={() => perform(() => startReply(m, false))}>Reply</button><button className={buttonClass} disabled={busy} onClick={() => perform(() => startReply(m, true))}>Reply all</button></div>
      </article>)}</div>
    </section>
    <section className="space-y-3 rounded border border-border p-4"><h2 className="text-xl">Fetch and import</h2><p>One-off fetch preserves the earlier source-link and reply-review import workflow.</p>
      <button className={buttonClass} disabled={busy || !account} onClick={() => perform(async () => { const result = await call({ action: "fetch", account, mailbox, since, limit: 20 }); setBatch(result); setSelected([]); setNotice(`${result.messages.length} messages fetched; ${result.skippedOversize} oversized messages skipped. Snapshot saved; mailbox flags unchanged.`); })}>Fetch recent mail</button>
      {batch?.messages.map(m => <article key={m.message_id} className="rounded border border-border p-3"><label><input type="checkbox" checked={selected.includes(m.message_id)} onChange={e => setSelected(e.target.checked ? [...selected, m.message_id] : selected.filter(id => id !== m.message_id))} /> {m.subject} — {m.from}</label><details><summary>Read message</summary><pre className="whitespace-pre-wrap break-words">{m.body_snippet}</pre></details>{m.links?.map(url => <div key={url} className="break-all">{url} <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { await call({ action: "lead", id: batch.id, messageId: m.message_id, url }); setNotice("Selected link added to the pipeline for evaluation."); })}>Add link to pipeline</button></div>)}</article>)}
      <button className={buttonClass} disabled={busy || !selected.length} onClick={() => perform(async () => { const result = await call({ action: "import", id: batch?.id, ids: selected }); setNotice(`Imported ${result.added} messages into reply review; no tracker statuses changed.`); })}>Import selected into reply review</button>
    </section>
    <section className="space-y-3 rounded border border-border p-4"><h2 className="text-xl">Compose {replyTarget ? "threaded reply" : "email"}</h2>
      <p>Preparing saves a frozen copy. Edit recipients, subject, body, or attachments before preparing; edits after prepare require a new prepared copy.</p>
      {replyTarget && <p>Replying to cached message {replyTarget}. The thread headers are attached during preparation.</p>}
      <label className="block">Application<select className={inputClass} disabled={busy} value={composeApp} onChange={e => setComposeApp(e.target.value)}><option value="">No application association</option>{applications.map(a => <option key={a.num} value={a.num}>#{a.num} {a.company} — {a.role}</option>)}</select></label>
      <label className="block">To<input className={inputClass} value={to} onChange={e => setTo(e.target.value)} /></label><label className="block">Cc<input className={inputClass} value={cc} onChange={e => setCc(e.target.value)} /></label><label className="block">Bcc<input className={inputClass} value={bcc} onChange={e => setBcc(e.target.value)} /></label><label className="block">Subject<input className={inputClass} value={subject} onChange={e => setSubject(e.target.value)} /></label>
      <div><label htmlFor="mail-body" className="block">Body</label><textarea id="mail-body" className={inputClass} rows={10} value={body} onChange={e => setBody(e.target.value)} /></div>
      <label className="block">Attachments (10 MB total)<input className="mt-2 block" type="file" multiple onChange={e => { const files = Array.from(e.target.files || []); void perform(async () => { if (files.length > 10 || files.reduce((n, f) => n + f.size, 0) > 10_000_000) throw new Error("At most 10 attachments, 10 MB total"); setAttachments(await Promise.all(files.map(f => new Promise<Attachment>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: f.name, dataBase64: String(reader.result).split(",")[1], bytes: f.size }); reader.onerror = () => reject(new Error("Attachment read failed")); reader.readAsDataURL(f); })))); }); }} /></label>
      {composeApp && <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={logFollowup} onChange={e => setLogFollowup(e.target.checked)} />Log this as a follow-up only after SMTP accepts the send</label>}
      <button className={buttonClass} disabled={busy || !account} onClick={() => perform(async () => { setPrepared(await call({ action: "prepare", account, messageId: replyTarget || undefined, appNum: composeApp ? Number(composeApp) : undefined, logFollowup: !!composeApp && logFollowup, draft: { to: recipients(to), cc: recipients(cc), bcc: recipients(bcc), subject, body, attachments } })); setAttempted(false); })}>Prepare for review</button>
      <button className={buttonClass} disabled={busy} onClick={() => { fillDraft({ to: [], cc: [], bcc: [], subject: "", body: "", attachments: [] }, null, null); setComposeApp(""); }}>New email</button>
    </section>
    <section className="space-y-3"><h2 className="text-xl">Saved emails and send receipts</h2><button className={buttonClass} disabled={busy} onClick={() => perform(async () => { setHistory((await call({ action: "history" })).drafts); })}>Load saved emails</button>
      {history.map(item => <div key={item.id} className="space-y-2 rounded border border-border p-3"><p>{item.subject} — {item.from} — {item.status}</p>{item.receipt && <p>SMTP receipt: {item.receipt.status || "recorded"}; follow-up log: {item.followup?.logged ? `logged${item.followup.num ? ` (#${item.followup.num})` : ""}` : item.followup?.error ? `pending (${item.followup.error})` : "not logged"}</p>}
        <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { const saved = await call({ action: "review", id: item.id }); setPrepared(saved); setAttempted(!!saved.receipt); setNotice(JSON.stringify(saved.receipt || { status: "not attempted" }, null, 2)); })}>Review {item.subject || "untitled email"}</button>
        {item.receipt?.status === "accepted" && !item.followup?.logged && <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { const result = await call({ action: "reconcile", id: item.id }); setNotice(`Follow-up log result: ${JSON.stringify(result)}. No email was sent by this recovery action.`); setHistory((await call({ action: "history" })).drafts); })}>Retry follow-up logging only</button>}
      </div>)}
    </section>
    {prepared && <section className="space-y-3 rounded border border-border p-4"><h2 className="text-xl">Review frozen email</h2><p>From: {prepared.payload.draft.from}</p><p>To: {prepared.payload.draft.to.join(", ")}</p><p>Cc: {prepared.payload.draft.cc.join(", ")}</p><p>Bcc: {prepared.payload.draft.bcc.join(", ")}</p><p>Subject: {prepared.payload.draft.subject}</p><pre className="whitespace-pre-wrap break-words">{prepared.payload.draft.body}</pre><p>Attachments: {prepared.payload.draft.attachments.map(a => `${a.name} (${a.bytes} bytes)`).join(", ") || "none"}</p><p>Application: {prepared.payload.application ? `#${prepared.payload.application.num} ${prepared.payload.application.company} — ${prepared.payload.application.role}` : "not linked"}; follow-up logging: {prepared.payload.logFollowup ? "on accepted receipt" : "off"}</p><p className="break-all">Review ID: {prepared.id} · Digest: {prepared.digest}</p>
      <button className={buttonClass} disabled={busy || attempted} onClick={() => perform(async () => { setAttempted(true); const result = await call({ action: "send", id: prepared.id, confirm: prepared.digest }); setNotice(JSON.stringify(result, null, 2) + "\nAccepted means accepted by SMTP, not delivered. Unknown means check your provider before preparing another send."); setHistory((await call({ action: "history" })).drafts); })}>Send this reviewed email</button>
      <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { const result = await call({ action: "review", id: prepared.id }); setNotice(JSON.stringify({ receipt: result.receipt || { status: "not attempted" }, followup: result.followup }, null, 2)); })}>Check send receipt</button>
    </section>}
  </main>;
}
