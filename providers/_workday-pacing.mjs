// Overlapping workers/containers can exhaust Workday's public request quota.
// SQLite transactions coordinate starts and cooldowns without
// keeping a lock during a network request or relying on container-local PIDs.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function parseRetryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export class WorkdayCooldownError extends Error {
  constructor(until) {
    const date = new Date(until);
    super(`Workday rate limit: requests deferred until ${Number.isNaN(date.getTime()) ? 'the upstream cooldown ends' : date.toISOString()}; retry later`);
    this.status = 429;
  }
}

export function workdayHost(url) {
  const host = new URL(url).hostname;
  return /\.(?:myworkdayjobs|myworkdaysite)\.com$/.test(host) ? host : null;
}

// Node's built-in SQLite is already part of Career-Ops' supported runtime.
// Load it only for real Workday traffic, leaving other providers untouched.
export async function createWorkdayPacer({ directory, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  hostIntervalMs = 1000, globalIntervalMs = 200,
  cooldownMs = 30000, maxCooldownMs = 120000, maxWaitMs = 180000 } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'pacing.sqlite'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS budgets (
    key TEXT PRIMARY KEY, next_at REAL NOT NULL DEFAULT 0,
    limited_at REAL NOT NULL DEFAULT 0, strikes INTEGER NOT NULL DEFAULT 0
  )`);
  const read = db.prepare('SELECT * FROM budgets WHERE key = ?');
  const write = db.prepare(`INSERT INTO budgets (key, next_at, limited_at, strikes) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET next_at=excluded.next_at,
    limited_at=excluded.limited_at, strikes=excluded.strikes`);
  const row = key => read.get(key) || { next_at: 0, limited_at: 0, strikes: 0 };
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async function start(host, request) {
    const deadline = now() + maxWaitMs;
    while (true) {
      const grant = transaction(() => {
        const time = now(), tenant = row(host), global = row('*');
        const until = Math.max(tenant.next_at, global.next_at);
        // Preserve a long Retry-After rather than capping it and requesting
        // early. A sweep gets an explicit deferred error instead of hanging.
        if (until - time > maxCooldownMs || until > deadline || time > deadline) throw new WorkdayCooldownError(until);
        if (until > time) return { delay: until - time };
        // Dispatch while owning the short transaction, then date the next
        // slot from dispatch. Dating it before COMMIT/Headers initialization
        // compressed the actual starts under contention (caught by the
        // independent-process regression). No network await holds this lock.
        let pending;
        try { pending = request(); } catch (error) { pending = Promise.reject(error); }
        const dispatched = now();
        write.run(host, dispatched + hostIntervalMs, tenant.limited_at, tenant.strikes);
        write.run('*', dispatched + globalIntervalMs, global.limited_at, global.strikes);
        return { pending };
      });
      if (!grant.delay) return grant;
      await wait(grant.delay);
      // Re-read after every wait: another worker may have reported a 429
      // since this one first queued. Reserved future slots would miss it.
    }
  }
  function limited(host, error) {
    transaction(() => {
      const time = now(), tenant = row(host), global = row('*');
      const strikes = time - tenant.limited_at < 600000 ? Math.min(tenant.strikes + 1, 10) : 1;
      const retryAfter = parseRetryAfterMs(error.retryAfter, time);
      const delay = retryAfter ?? Math.min(cooldownMs * 2 ** (strikes - 1), maxCooldownMs);
      write.run(host, Math.max(tenant.next_at, time + delay), time, strikes);
      // An edge-wide block can affect another tenant (Park failed on page 0
      // during the LSU/Ivy bursts), so also pause other Workday hosts briefly.
      write.run('*', Math.max(global.next_at, time + Math.min(delay, cooldownMs)), time, global.strikes);
    });
  }
  return {
    async run(host, request) {
      const { pending } = await start(host, request);
      try { return await pending; }
      catch (error) {
        if (error?.status === 429) limited(host, error);
        throw error;
      }
    },
    close() { db.close(); },
  };
}

let defaultPacer;
export async function paceWorkdayRequest(url, request) {
  const host = workdayHost(url);
  if (!host) return request();
  const directory = process.env.CAREER_OPS_WORKDAY_PACING_DIR
    || join(tmpdir(), `career-ops-workday-${process.getuid?.() ?? 'user'}`);
  defaultPacer ??= createWorkdayPacer({ directory });
  return (await defaultPacer).run(host, request);
}
