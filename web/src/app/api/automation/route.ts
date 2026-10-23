import { runAutomation, AutomationCoreError } from "@/lib/core/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const e = error instanceof AutomationCoreError ? error : new AutomationCoreError(error instanceof Error ? error.message : "Automation request failed");
  return Response.json({ error: e.message, ...(e.current === undefined ? {} : { current: e.current }) }, { status: e.status });
}

export async function GET() {
  try { return Response.json(await runAutomation({ action: "status" }), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  if (!sameOriginJson(request)) return Response.json({ error: "Same-origin JSON request required" }, { status: 403 });
  try {
    const input = await readJson(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AutomationCoreError("JSON object required");
    const { action, ...fields } = input as Record<string, unknown>;
    if (action === "config") {
      if (!fields.patch || typeof fields.patch !== "object" || Array.isArray(fields.patch)) throw new AutomationCoreError("Config patch object required");
      return Response.json(await runAutomation({ action, patch: fields.patch }));
    }
    if (action === "pause" || action === "resume") return Response.json(await runAutomation({ action }));
    if (action === "retry") {
      if (typeof fields.taskId !== "string" || !fields.taskId) throw new AutomationCoreError("taskId is required");
      return Response.json(await runAutomation({ action, id: fields.taskId }));
    }
    throw new AutomationCoreError("Unknown automation action");
  } catch (error) { return jsonError(error); }
}

function sameOriginJson(request: Request): boolean {
  try {
    const origin = new URL(request.headers.get("origin") || "");
    return ["http:", "https:"].includes(origin.protocol)
      && origin.host === (request.headers.get("host") || new URL(request.url).host)
      && !!request.headers.get("content-type")?.startsWith("application/json");
  } catch { return false; }
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 1_000_000) throw new AutomationCoreError("Request exceeds 1 MB", 413);
  try { return JSON.parse(text); }
  catch { throw new AutomationCoreError("Invalid JSON"); }
}
