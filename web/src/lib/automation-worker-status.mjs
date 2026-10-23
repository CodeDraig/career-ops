import fs from "node:fs";
import path from "node:path";

export function automationWorkerStatus(root, { now = Date.now(), staleMs = 180_000, isAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
} } = {}) {
  const configPath = path.join(root, "config", "automation.json");
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { enabled: false, state: "disabled", paused: false, at: null, active: null, lastError: null };
    return { enabled: false, state: "invalid-config", paused: false, at: null, active: null, lastError: "Automation configuration could not be read." };
  }
  if (!config || typeof config !== "object" || Array.isArray(config) || typeof config.enabled !== "boolean") {
    return { enabled: false, state: "invalid-config", paused: false, at: null, active: null, lastError: "Automation configuration is invalid." };
  }
  if (!config.enabled) return { enabled: false, state: "disabled", paused: false, at: null, active: null, lastError: null };

  const heartbeatPath = path.join(root, "data", "automation", "worker-heartbeat.json");
  let heartbeat;
  try {
    heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { enabled: true, state: "starting", paused: false, at: null, active: null, lastError: null };
    return { enabled: true, state: "stale", paused: false, at: null, active: null, lastError: "Automation worker heartbeat could not be read." };
  }
  const timestamp = typeof heartbeat?.at === "string" ? Date.parse(heartbeat.at) : NaN;
  const fresh = Number.isFinite(timestamp) && now - timestamp < staleMs && timestamp <= now + 30_000;
  const running = fresh && heartbeat.enabled === true && isAlive(heartbeat.pid);
  return {
    enabled: true,
    state: running ? heartbeat.paused === true ? "paused" : "running" : "stale",
    paused: running && heartbeat.paused === true,
    at: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    active: running && heartbeat.active && typeof heartbeat.active === "object" ? heartbeat.active : null,
    lastError: typeof heartbeat.lastError === "string" ? heartbeat.lastError : null,
  };
}
