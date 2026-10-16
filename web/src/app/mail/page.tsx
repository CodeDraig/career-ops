"use client";
import { useEffect, useState } from "react";
type Account = { id: string; from: string; imap: boolean; smtp: boolean; ready: string[] };
type Message = { message_id: string; from: string; subject: string; body_snippet: string; truncated: boolean; attachments: string[]; links: string[] };
type Attachment = { name: string; dataBase64: string; bytes?: number };
type Prepared = { id: string; digest: string; payload: { draft: { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; attachments: Attachment[] } } };
async function call(input: unknown) {
  const response = await fetch("/api/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || "Mail request failed"); return data;
}
export default function MailPage() {
  const [accounts, setAccounts] = useState<Account[]>([]), [account, setAccount] = useState("");
  const [mailbox, setMailbox] = useState("INBOX"), [since, setSince] = useState(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [batch, setBatch] = useState<{ id: string; messages: Message[] } | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [to, setTo] = useState(""), [cc, setCc] = useState(""), [bcc, setBcc] = useState(""), [subject, setSubject] = useState(""), [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]), [prepared, setPrepared] = useState<Prepared | null>(null);
  const [history, setHistory] = useState<{ id: string; subject: string; from: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [attempted, setAttempted] = useState(false);
  useEffect(() => { fetch("/api/mail").then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); setAccounts(d.accounts); setAccount(d.accounts[0]?.id || ""); }).catch(e => setNotice(e.message)); }, []);
  async function perform(work: () => Promise<void>) { setBusy(true); setNotice(""); try { await work(); } catch (e) { setNotice(e instanceof Error ? e.message : "Mail failed"); } finally { setBusy(false); } }
  const inputClass = "w-full rounded border border-border bg-background p-2";
  const buttonClass = "rounded border border-border px-3 py-2 disabled:opacity-40";
  const recipients = (value: string) => value.split(",").map(s => s.trim()).filter(Boolean);
  return <main className="mx-auto max-w-4xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">Mail</h1>
    <p>Read selected mail into reply review, or prepare an email and review it before sending. Email content is untrusted source material.</p>
    <p role="status" className="whitespace-pre-wrap">{notice}</p>
    {!accounts.length && <p>Configure config/mail.json in your data directory and supply its credential environment variables to the web server. See docs/MAIL.md. Python 3 is required.</p>}
    <label className="block">Account<select className={inputClass} value={account} onChange={e => setAccount(e.target.value)}>{accounts.map(a => <option key={a.id} value={a.id}>{a.id} — {a.from} (ready: {a.ready.join(", ") || "credentials missing"})</option>)}</select></label>
    <section className="space-y-3"><h2 className="text-xl">Inbox</h2>
      <label className="block">Mailbox<input className={inputClass} value={mailbox} onChange={e => setMailbox(e.target.value)} /></label>
      <label className="block">Since<input className={inputClass} type="date" value={since} onChange={e => setSince(e.target.value)} /></label>
      <button className={buttonClass} disabled={busy || !account} onClick={() => perform(async () => { const result = await call({ action: "fetch", account, mailbox, since, limit: 20 }); setBatch(result); setSelected([]); setNotice(`${result.messages.length} messages fetched; ${result.skippedOversize} oversized messages skipped. A local snapshot was saved; mailbox flags are unchanged.`); })}>Fetch recent mail</button>
      {batch?.messages.map(m => <article key={m.message_id} className="rounded border border-border p-3">
        <label><input type="checkbox" checked={selected.includes(m.message_id)} onChange={e => setSelected(e.target.checked ? [...selected, m.message_id] : selected.filter(id => id !== m.message_id))} /> {m.subject} — {m.from}</label>
        <details><summary>Read message</summary><pre className="whitespace-pre-wrap break-words">{m.body_snippet}</pre>{m.truncated && <p>Message truncated.</p>}<p>Attachments (not downloaded): {m.attachments.join(", ") || "none"}</p></details>
        {m.links?.map(url => <div key={url} className="break-all"><span>{url}</span> <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { await call({ action: "lead", id: batch.id, messageId: m.message_id, url }); setNotice("Selected link added to the pipeline for evaluation."); })}>Add link to pipeline</button></div>)}
      </article>)}
      <button className={buttonClass} disabled={busy || !selected.length} onClick={() => perform(async () => { const result = await call({ action: "import", id: batch?.id, ids: selected }); setNotice(`Imported ${result.added} messages. Run reply-watch to classify and review proposed changes; no tracker statuses changed.`); })}>Import selected into reply review</button>
    </section>
    <section className="space-y-3"><h2 className="text-xl">Compose</h2>
      <p>Use comma-separated plain email addresses. Preparing saves a frozen copy; edits below require another Prepare.</p>
      <label className="block">To<input className={inputClass} value={to} onChange={e => setTo(e.target.value)} /></label>
      <label className="block">Cc<input className={inputClass} value={cc} onChange={e => setCc(e.target.value)} /></label>
      <label className="block">Bcc<input className={inputClass} value={bcc} onChange={e => setBcc(e.target.value)} /></label>
      <label className="block">Subject<input className={inputClass} value={subject} onChange={e => setSubject(e.target.value)} /></label>
      <div><label htmlFor="mail-body" className="block">Body</label><textarea id="mail-body" className={inputClass} rows={10} value={body} onChange={e => setBody(e.target.value)} /></div>
      <label className="block">Attachments (10 MB total)<input className="mt-2 block" type="file" multiple onChange={e => { const files = Array.from(e.target.files || []); void perform(async () => { if (files.length > 10 || files.reduce((n, f) => n + f.size, 0) > 10_000_000) throw new Error("At most 10 attachments, 10 MB total"); setAttachments(await Promise.all(files.map(f => new Promise<Attachment>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: f.name, dataBase64: String(reader.result).split(",")[1] }); reader.onerror = () => reject(new Error("Attachment read failed")); reader.readAsDataURL(f); })))); }); }} /></label>
      <button className={buttonClass} disabled={busy || !account} onClick={() => perform(async () => { setPrepared(await call({ action: "prepare", account, draft: { to: recipients(to), cc: recipients(cc), bcc: recipients(bcc), subject, body, attachments } })); setAttempted(false); })}>Prepare for review</button>
    </section>
    <section className="space-y-3"><h2 className="text-xl">Saved emails</h2>
      <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { setHistory((await call({ action: "history" })).drafts); })}>Load saved emails</button>
      {history.map(item => <div key={item.id} className="rounded border border-border p-3"><p>{item.subject} — {item.from} — {item.status}</p>
        <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { const saved = await call({ action: "review", id: item.id }); setPrepared(saved); setAttempted(!!saved.receipt); setNotice(JSON.stringify(saved.receipt || { status: "not attempted" }, null, 2)); })}>Review {item.subject || "untitled email"}</button></div>)}
    </section>
    {prepared && <section className="space-y-3 rounded border border-border p-4"><h2 className="text-xl">Review frozen email</h2>
      <p>From: {prepared.payload.draft.from}</p><p>To: {prepared.payload.draft.to.join(", ")}</p><p>Cc: {prepared.payload.draft.cc.join(", ")}</p><p>Bcc: {prepared.payload.draft.bcc.join(", ")}</p><p>Subject: {prepared.payload.draft.subject}</p>
      <pre className="whitespace-pre-wrap break-words">{prepared.payload.draft.body}</pre><p>Attachments: {prepared.payload.draft.attachments.map(a => `${a.name} (${a.bytes} bytes)`).join(", ") || "none"}</p>
      <p className="break-all">Review ID: {prepared.id} · Digest: {prepared.digest}</p>
      <button className={buttonClass} disabled={busy || attempted} onClick={() => perform(async () => { setAttempted(true); const result = await call({ action: "send", id: prepared.id, confirm: prepared.digest }); setNotice(JSON.stringify(result, null, 2) + "\nAccepted means accepted by the SMTP server, not delivered or applied. Unknown means check your provider before preparing another send."); })}>Send this reviewed email</button>
      <button className={buttonClass} disabled={busy} onClick={() => perform(async () => { const result = await call({ action: "review", id: prepared.id }); setNotice(JSON.stringify(result.receipt || { status: "not attempted" }, null, 2)); })}>Check send receipt</button>
    </section>}
  </main>;
}
