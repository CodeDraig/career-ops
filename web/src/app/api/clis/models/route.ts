import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveCli } from "@/lib/clis";
import { codexModelOptions } from "@/lib/ai-search-settings.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const execFileAsync = promisify(execFile);

export async function GET() {
  const cli = resolveCli("codex");
  if (!cli) return Response.json({ models: [], error: "Codex is not installed. Enter a model ID manually." });
  try {
    // Local catalog only: no model requests, credentials, or provider calls.
    const { stdout } = await execFileAsync(cli.binPath, ["debug", "models", "--bundled"], {
      timeout: 5000, maxBuffer: 8 * 1024 * 1024,
    });
    return Response.json({ models: codexModelOptions(JSON.parse(stdout)) });
  } catch {
    return Response.json({ models: [], error: "Could not load Codex's model list. Enter a model ID manually." });
  }
}
