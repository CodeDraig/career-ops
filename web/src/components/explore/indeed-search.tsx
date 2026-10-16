"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { DiscoveredOffer } from "@/lib/explore";

type IndeedOffer = DiscoveredOffer & { id: string };
const jobKey = (url: string) => {
  try { const parsed = new URL(url); return /(^|\.)indeed\.com$/.test(parsed.hostname) ? (parsed.searchParams.get("jk") || parsed.searchParams.get("vjk"))?.toLowerCase() : null; } catch { return null; }
};

export function IndeedSearch({ knownUrls }: { knownUrls: string[] }) {
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("");
  const [offers, setOffers] = useState<IndeedOffer[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [searchUrl, setSearchUrl] = useState("");
  const [known, setKnown] = useState(() => new Set(knownUrls.map(jobKey).filter(Boolean)));
  const [details, setDetails] = useState<Record<string, { description: string; closed: boolean }>>({});
  const [notice, setNotice] = useState("");

  async function search(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); setOffers([]); setWarnings([]); setSearched(false); setSearchUrl("");
    try {
      const response = await fetch("/api/explore/indeed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords, location }) });
      const data = await response.json();
      if (data.url?.startsWith("https://www.indeed.com/jobs?")) setSearchUrl(data.url);
      if (!response.ok) throw new Error(data.message || data.error || "Indeed search failed.");
      setOffers(data.offers); setWarnings(data.warnings || []); setSearched(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Indeed search failed."); }
    finally { setBusy(false); }
  }

  async function inspect(offer: IndeedOffer) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/explore/indeed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "job", id: offer.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "Description unavailable.");
      setDetails(current => ({ ...current, [offer.id]: { description: data.description, closed: data.closed } }));
    } catch (error) { setError(error instanceof Error ? error.message : "Description unavailable."); }
    finally { setBusy(false); }
  }

  async function add(offer: IndeedOffer) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/explore/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offers: [offer] }) });
      const data = await response.json();
      if (!response.ok || data.added !== 1) throw new Error(data.error || "Could not add the job.");
      setKnown(current => new Set([...current, offer.id])); setNotice("Added to your pipeline. Review and evaluate it there.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not add the job."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-4xl px-5 py-8 md:px-8">
    <Link href="/explore" className="text-sm text-brand-text">← Explore</Link>
    <h1 className="mt-4 text-3xl text-foreground">Indeed jobs</h1>
    <p className="mt-2 text-muted">Search one page using your connected Chrome extension session. Search and description reads do not change your pipeline.</p>
    <form onSubmit={search} className="my-6 flex flex-wrap items-end gap-4 rounded-2xl border border-border p-5">
      <label className="flex min-w-0 flex-1 flex-col gap-2">Keywords<input required maxLength={200} value={keywords} onChange={event => setKeywords(event.target.value)} placeholder="support engineer" className="rounded-lg border border-border bg-surface p-3" /></label>
      <label className="flex min-w-0 flex-1 flex-col gap-2">Location<input maxLength={200} value={location} onChange={event => setLocation(event.target.value)} placeholder="Remote, city or region" className="rounded-lg border border-border bg-surface p-3" /></label>
      <Button disabled={busy || !keywords.trim()} type="submit">{busy ? "Working…" : "Search Indeed"}</Button>
    </form>
    {error && <p role="alert" className="mb-4 rounded-xl border border-border p-4 text-foreground">{error}</p>}
    {notice && <p role="status" className="mb-4 text-brand-text">{notice} <Link href="/pipeline" className="underline">Open pipeline</Link></p>}
    {searchUrl && <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="text-brand-text underline">Open this search on Indeed</a>}
    {warnings.map(warning => <p key={warning} className="my-3 text-sm text-muted">{warning}</p>)}
    {searched && !offers.length && <p role="status" className="my-6">Indeed reported no matching jobs.</p>}
    <div className="mt-5 space-y-4">{offers.map(offer => <article key={offer.id} className="rounded-2xl border border-border bg-surface/30 p-5">
      <h2 className="text-lg font-semibold"><a href={offer.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{offer.title}</a></h2>
      <p className="mt-1 text-muted">{offer.company || "Company not provided"} · {offer.location || "Location not provided"}</p>
      <p className="my-3 text-xs text-muted">Employer opening unverified</p>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={busy || Boolean(details[offer.id])} onClick={() => inspect(offer)}>{details[offer.id] ? "Description loaded" : "Read description"}</Button>
        <Button disabled={busy || known.has(offer.id) || details[offer.id]?.closed} onClick={() => add(offer)}>{known.has(offer.id) ? "Already in pipeline or tracker" : details[offer.id]?.closed ? "Posting closed" : "Add to pipeline"}</Button>
      </div>
      {details[offer.id] && <details open className="mt-4"><summary>Job description{details[offer.id].closed ? " — posting closed" : ""}</summary><p className="mt-3 whitespace-pre-wrap text-sm">{details[offer.id].description}</p></details>}
    </article>)}</div>
  </main>;
}
