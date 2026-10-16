import { execFile } from "node:child_process";
import { rootScript, careerOpsCodeRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid request." }, { status: 400 });
  let args: string[];
  if (body.action === "job") {
    if (typeof body.id !== "string" || !/^[a-f0-9]{16}$/i.test(body.id)) return Response.json({ error: "Invalid Indeed job key." }, { status: 400 });
    args = ["--id", body.id];
  } else {
    if ((body.action && body.action !== "search") || typeof body.keywords !== "string" || !body.keywords.trim() || body.keywords.length > 200 || (body.location !== undefined && (typeof body.location !== "string" || body.location.length > 200))) {
      return Response.json({ error: "Enter keywords and an optional location (up to 200 characters each)." }, { status: 400 });
    }
    // Equals forms ensure a query beginning with '--' stays a value.
    args = [`--keywords=${body.keywords}`, `--location=${body.location || ""}`];
  }
  return new Promise<Response>(resolve => {
    execFile(process.execPath, [rootScript("indeed-search"), ...args], {
      cwd: careerOpsCodeRoot(), timeout: 110000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => {
      try {
        const result = JSON.parse(stdout);
        if (typeof result.status !== "string") throw new Error("Missing status");
        resolve(Response.json(result, { status: ["ok", "empty"].includes(result.status) ? 200 : 503 }));
      } catch {
        resolve(Response.json({ error: error ? "Indeed search could not run. Check that this Career-Ops engine includes indeed-search.mjs and the browser-harness Chrome extension is configured." : "Indeed search returned an unreadable response." }, { status: 503 }));
      }
    });
  });
}
