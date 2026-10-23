import { runAutomation, AutomationCoreError } from "@/lib/core/automation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function responseError(error: unknown) {
  const e = error instanceof AutomationCoreError ? error : new AutomationCoreError(error instanceof Error ? error.message : "Automation review failed");
  return Response.json({ error: e.message, ...(e.current === undefined ? {} : { current: e.current }) }, { status: e.status });
}
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(await runAutomation({ action: "reviews", filters: { id } }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
export async function POST(request: Request, context: Context) {
  if (!sameOriginJson(request)) return Response.json({ error: "Same-origin JSON request required" }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 1_000_000) throw new AutomationCoreError("Request exceeds 1 MB", 413);
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new AutomationCoreError("Invalid JSON"); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new AutomationCoreError("JSON object required");
    const { id } = await context.params;
    return Response.json(await runAutomation({ action: "review", id, payload }));
  } catch (error) { return responseError(error); }
}
function sameOriginJson(request: Request): boolean {
  try {
    const origin = new URL(request.headers.get("origin") || "");
    return ["http:", "https:"].includes(origin.protocol)
      && origin.host === (request.headers.get("host") || new URL(request.url).host)
      && !!request.headers.get("content-type")?.startsWith("application/json");
  } catch { return false; }
}
