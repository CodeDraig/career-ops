import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function searchDirs() {
  const home = os.homedir();
  const extra = [path.join(home, ".local/bin"), path.join(home, ".grok/bin"), path.join(home, ".npm-global/bin"), path.join(home, ".bun/bin"), path.join(home, ".deno/bin"), path.join(home, ".opencode/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    extra.push(path.join(localAppData, "agy", "bin"), path.join(localAppData, "grok", "bin"), path.join(localAppData, "Microsoft", "WindowsApps"), path.join(appData, "npm"));
  }
  const fromPath = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return [...new Set([...fromPath, ...extra])];
}

function binCandidates(bin) {
  if (process.platform !== "win32") return [bin];
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.trim()).filter(Boolean)
    .filter((e) => [".com", ".exe", ".bat", ".cmd"].includes(e.toLowerCase()));
  return [bin, ...exts.map((ext) => bin + ext)];
}

/** Resolve a CLI binary using the same search locations as the web CLI catalog. */
export function findBin(bin, dirs = searchDirs()) {
  for (const dir of dirs) {
    for (const candidate of binCandidates(bin)) {
      const target = path.join(dir, candidate);
      try {
        fs.accessSync(target, fs.constants.X_OK);
        return target;
      } catch { /* continue searching */ }
    }
  }
  return null;
}
