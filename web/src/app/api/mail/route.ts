import { runMail } from "@/lib/core/mail";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json(await runMail({ action: "accounts" })); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Mail failed" }, { status: 400 }); }
}
export async function POST(request: Request) {
  // A foreign page must not drive the local SMTP account through a form/fetch.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") || "");
    // Next may normalize request.url to localhost even when the browser uses
    // 127.0.0.1. Host retains the browser-facing authority; proxy.ts validates it.
    sameOrigin = ["http:", "https:"].includes(origin.protocol)
      && origin.host === (request.headers.get("host") || new URL(request.url).host);
  } catch { /* Missing or malformed Origin is refused. */ }
  if (!sameOrigin || !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Same-origin JSON request required" }, { status: 403 });
  }
  try {
    const text = await request.text();
    if (text.length > 16_000_000) return Response.json({ error: "Request exceeds 16 MB" }, { status: 413 });
    const input = JSON.parse(text);
    if (!["history", "fetch", "import", "lead", "sync", "messages", "match", "reply", "prepare", "review", "send", "reconcile"].includes(input.action)) throw new Error("Unknown mail action");
    return Response.json(await runMail(input));
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Mail failed" }, { status: 400 }); }
}
