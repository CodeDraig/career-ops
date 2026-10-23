import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pass, fail, rmSync, ROOT } from '../helpers.mjs';
import { createWorkdayPacer, parseRetryAfterMs, WorkdayCooldownError, workdayHost } from '../../providers/_workday-pacing.mjs';
import { isRetryableError } from '../../providers/_http.mjs';

const root = mkdtempSync(join(tmpdir(), 'career-workday-pacing-'));
const host = 'example.wd1.myworkdayjobs.com';
let sequence = 0;
async function check(label, fn) {
  const directory = join(root, String(++sequence));
  try { await fn(directory); pass(label); } catch (error) { fail(`${label}: ${error.stack}`); }
}
try {
  await check('Workday pacing matches only Workday hosts and parses both Retry-After forms', async () => {
    assert.equal(workdayHost(`https://${host}/wday/cxs/example/jobs`), host);
    assert.equal(workdayHost('https://wd1.myworkdaysite.com/recruiting/a/b'), 'wd1.myworkdaysite.com');
    assert.equal(workdayHost('https://fake.myworkdayjobs.com.example.org/jobs'), null);
    assert.equal(workdayHost('https://example.org/jobs'), null);
    assert.equal(parseRetryAfterMs('60', 0), 60000);
    assert.equal(parseRetryAfterMs('Thu, 01 Jan 1970 00:01:00 GMT', 1000), 59000);
    assert.equal(parseRetryAfterMs('nonsense'), null);
  });
  await check('Workday page, detail, retry and process-restart requests share their host budget', async directory => {
    let time = 100000;
    const starts = [], sleeps = [];
    const options = { directory, now: () => time, wait: async ms => { sleeps.push(ms); time += ms; } };
    const first = await createWorkdayPacer(options);
    await first.run(host, async () => starts.push(time));
    first.close();
    const restarted = await createWorkdayPacer(options);
    try {
      await restarted.run(host, async () => starts.push(time));
      await restarted.run('other.wd1.myworkdayjobs.com', async () => starts.push(time));
      assert.deepEqual(starts, [100000, 101000, 101200]);
      assert.deepEqual(sleeps, [1000, 200]);
    } finally { restarted.close(); }
  });
  await check('Workday 429 without Retry-After pauses all workers and backs off repeated limits', async directory => {
    let time = 100000;
    const starts = [];
    const options = { directory, now: () => time, wait: async ms => { time += ms; } };
    const a = await createWorkdayPacer(options), b = await createWorkdayPacer(options);
    const limited = () => { starts.push(time); throw Object.assign(new Error('429'), { status: 429 }); };
    try {
      await assert.rejects(a.run(host, limited), /429/);
      await b.run('other.wd1.myworkdayjobs.com', async () => starts.push(time));
      await assert.rejects(b.run(host, limited), /429/);
      await a.run(host, async () => starts.push(time));
      assert.deepEqual(starts, [100000, 130000, 130200, 190200]);
    } finally { a.close(); b.close(); }
  });
  await check('Workday waiters recheck cooldowns reported by another worker while queued', async directory => {
    let time = 100000, injected = false;
    const other = await createWorkdayPacer({ directory, now: () => time, wait: async ms => { time += ms; } });
    const pacer = await createWorkdayPacer({ directory, now: () => time, wait: async ms => {
      time += ms;
      if (!injected) {
        injected = true;
        await assert.rejects(other.run(host, async () => { throw Object.assign(new Error('429'), { status: 429, retryAfter: '45' }); }));
      }
    } });
    try {
      await pacer.run(host, async () => {});
      let started;
      await pacer.run(host, async () => { started = time; });
      assert.equal(started, 146000);
    } finally { pacer.close(); other.close(); }
  });
  await check('Workday honours a long Retry-After without retrying early or hanging the sweep', async directory => {
    let time = 100000, requests = 0;
    const pacer = await createWorkdayPacer({ directory, now: () => time, wait: async ms => { time += ms; } });
    try {
      await assert.rejects(pacer.run(host, async () => {
        requests++;
        throw Object.assign(new Error('429'), { status: 429, retryAfter: '86400' });
      }));
      await assert.rejects(pacer.run(host, async () => { requests++; }), error => {
        assert(error instanceof WorkdayCooldownError);
        assert.equal(isRetryableError(error), false);
        return /deferred until/.test(error.message);
      });
      assert.equal(requests, 1);
      assert.equal(time, 100000);
    } finally { pacer.close(); }
  });
  await check('Workday pacing serializes simultaneous independent processes using the same SQLite file', async directory => {
    const module = new URL('../../providers/_workday-pacing.mjs', import.meta.url).href;
    const child = `import {createWorkdayPacer} from ${JSON.stringify(module)};
      const p=await createWorkdayPacer({directory:process.argv[1],hostIntervalMs:60,globalIntervalMs:5});
      for(let n=0;n<3;n++) await p.run('shared.wd1.myworkdayjobs.com',async()=>console.log(Date.now()));
      p.close();`;
    const results = await Promise.all(Array.from({ length: 3 }, () => promisify(execFile)(process.execPath,
      ['--no-warnings', '--input-type=module', '-e', child, directory], { timeout: 10000 })));
    const starts = results.flatMap(result => result.stdout.trim().split('\n').map(Number)).sort((a, b) => a - b);
    assert.equal(starts.length, 9);
    for (let n = 1; n < starts.length; n++) assert(starts[n] - starts[n - 1] >= 55, JSON.stringify(starts));
  });
  await check('Workday transport paces actual POST pages and GET details before the request timeout starts', async directory => {
    const child = `import assert from 'node:assert/strict';
      process.env.CAREER_OPS_WORKDAY_PACING_DIR=process.argv[1];
      const {fetchJson,fetchJsonWithRetry}=await import('./providers/_http.mjs');
      const starts=[],methods=[];let attempts=0;
      globalThis.fetch=async(url,options)=>{starts.push(Date.now());methods.push(options.method);
        assert(!options.signal.aborted);return new Response(JSON.stringify({ok:true}));};
      const url='https://example.wd1.myworkdayjobs.com/wday/cxs/example/Careers/jobs';
      await fetchJson(url,{method:'POST',body:'{}',timeoutMs:50});
      await fetchJson(url.replace('/jobs','/job/test'),{timeoutMs:50});
      assert(starts[1]-starts[0]>=990);assert.deepEqual(methods,['POST','GET']);
      globalThis.fetch=async()=>{attempts++;return new Response('',{status:429,headers:{'retry-after':'86400'}})};
      await assert.rejects(fetchJsonWithRetry({fetchJson,sleep:async()=>{}},url),/deferred until/);
      assert.equal(attempts,1);`;
    await promisify(execFile)(process.execPath, ['--no-warnings', '--input-type=module', '-e', child, directory],
      { cwd: ROOT, timeout: 10000 });
    const data = readFileSync(join(directory, 'pacing.sqlite'));
    assert(!data.includes(Buffer.from('/wday/cxs')));
  });
} finally { rmSync(root, { recursive: true, force: true }); }
