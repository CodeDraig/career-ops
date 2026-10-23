import { runAutomation, AutomationCoreError } from "@/lib/core/automation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const filters = Object.fromEntries(["state", "type"].flatMap((key) => url.searchParams.has(key) ? [[key, url.searchParams.get(key)]] : []));
    return Response.json(await runAutomation({ action: "reviews", filters }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const e = error instanceof AutomationCoreError ? error : new AutomationCoreError("Could not list automation reviews");
    return Response.json({ error: e.message, ...(e.current === undefined ? {} : { current: e.current }) }, { status: e.status });
  }
}
