import { runAutomation, AutomationCoreError } from "@/lib/core/automation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await runAutomation({ action: "config" }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    const e = error instanceof AutomationCoreError ? error : new AutomationCoreError("Could not read automation configuration");
    return Response.json({ error: e.message, ...(e.current === undefined ? {} : { current: e.current }) }, { status: e.status });
  }
}

export async function PUT(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") || "");
    const sameOrigin = ["http:", "https:"].includes(origin.protocol)
      && origin.host === (request.headers.get("host") || new URL(request.url).host);
    if (!sameOrigin || !request.headers.get("content-type")?.startsWith("application/json")) {
      return Response.json({ error: "Same-origin JSON request required" }, { status: 403 });
    }
    const text = await request.text();
    if (text.length > 1_000_000) return Response.json({ error: "Request exceeds 1 MB" }, { status: 413 });
    let patch: unknown;
    try { patch = JSON.parse(text); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return Response.json({ error: "Config patch object required" }, { status: 400 });
    return Response.json(await runAutomation({ action: "config", patch }));
  } catch (error) {
    const e = error instanceof AutomationCoreError ? error : new AutomationCoreError(error instanceof Error ? error.message : "Could not update automation configuration");
    return Response.json({ error: e.message, ...(e.current === undefined ? {} : { current: e.current }) }, { status: e.status });
  }
}
