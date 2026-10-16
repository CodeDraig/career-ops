import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
export function runMail(request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [rootScript("mail"), "--request"], {
      cwd: careerOpsRoot(), env: { ...process.env, CAREER_OPS_ROOT: careerOpsRoot() },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Mail request timed out; review any send receipt before retrying")); }, 140000);
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error("Mail core could not start")); });
    child.on("close", code => {
      clearTimeout(timer);
      try {
        if (code) { const result = JSON.parse(err); reject(new Error(result.error || "Mail core failed")); }
        else resolve(JSON.parse(out));
      } catch { reject(new Error("Mail core returned no result")); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
