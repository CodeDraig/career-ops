import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

export class AutomationCoreError extends Error {
  status: number;
  current?: unknown;
  constructor(message: string, status = 400, current?: unknown) {
    super(message);
    this.name = "AutomationCoreError";
    this.status = status;
    this.current = current;
  }
}

export function runAutomation(request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const root = careerOpsRoot();
    const child = spawn(process.execPath, [rootScript("automation"), "--request"], {
      cwd: root,
      env: { ...process.env, CAREER_OPS_ROOT: root },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "", finished = false;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new AutomationCoreError("Automation request timed out", 504));
    }, 30_000);
    child.stdout.on("data", (data: Buffer) => { out += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { err += data.toString(); });
    child.stdin.on("error", () => {});
    child.on("error", () => fail(new AutomationCoreError("Automation core could not start", 500)));
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        if (code) {
          const jsonLine = err.split(/\r?\n/).reverse().find((line) => line.trim().startsWith("{"));
          const details = JSON.parse(jsonLine || "{}");
          reject(new AutomationCoreError(details.error || "Automation request failed", details.status || 400, details.current));
        } else resolve(JSON.parse(out));
      } catch {
        reject(new AutomationCoreError("Automation core returned no result", 502));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
