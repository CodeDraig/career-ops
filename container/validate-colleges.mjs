#!/usr/bin/env node
// Execute the supplied 346-school inventory inside Docker, with one independent
// receipt per school. This never reads or writes a live portals.yml or tracker.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadProviders, resolveProvider } from '../providers/_registry.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';
import { searchBrowserJobs } from '../browser-job-search.mjs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { validateFlags } from '../lib/cli-flags.mjs';

const codeRoot = fileURLToPath(new URL('../', import.meta.url));
const sha = text => createHash('sha256').update(text).digest('hex');
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

export function validateInventory(inventory) {
  if (!Array.isArray(inventory.schools) || inventory.schools.length !== 346 ||
      new Set(inventory.schools.map(row => row.unitid)).size !== 346 ||
      inventory.schools.some(row => !/^\d{6}$/.test(row.unitid) || !row.name || (!row.entry && !row.probeUrl))) {
    throw new Error('Expected exactly 346 distinct UNITIDs, each with a configured route or unresolved-source probe');
  }
}

export function classifySearch(jobs, warnings) {
  if (!Array.isArray(jobs)) throw new Error('Provider returned no jobs array');
  if (warnings.some(line => /truncat|incomplete|returning .* fetched so far|stopped at .* pages|failed|offset.clamped.*incomplete/i.test(line))) {
    throw new Error('Provider reported partial or failed pagination: ' + warnings.join(' | '));
  }
  if (jobs.some(job => !job.title?.trim() || !/^https?:\/\//.test(job.url || ''))) {
    throw new Error('A posting has no title or public URL');
  }
  if (new Set(jobs.map(job => job.url)).size !== jobs.length) throw new Error('Duplicate posting URLs');
  return jobs.length ? 'working' : 'empty';
}

export function failedSchoolsForRetry(summary, inventorySha256) {
  if (summary?.inventorySha256 !== inventorySha256) throw new Error('Inventory does not match the original run receipt');
  return (summary.schools || []).filter(row => ['error', 'incomplete'].includes(row.status) && row.complete !== true);
}

export function buildCoverageOverlay(originalSummary, recoveredSchools, originalReceipt) {
  const recoveredById = new Map(recoveredSchools.map(row => [row.unitid, row]));
  const schools = (originalSummary.schools || []).map(original => {
    const recovery = recoveredById.get(original.unitid);
    return recovery ? { ...original, recovery,
      effectiveStatus: recovery.complete ? recovery.status : original.status,
      effectiveComplete: recovery.complete === true } : { ...original,
      effectiveStatus: original.status, effectiveComplete: original.complete === true };
  });
  const counts = Object.fromEntries(['working', 'empty', 'unresolved', 'error'].map(status => [status,
    schools.filter(row => row.effectiveStatus === status).length]));
  return { schema: 'career-ops.college-validation-overlay@1', originalReceipt, total: schools.length, counts,
    coveragePercent: Math.round((counts.working + counts.empty) / schools.length * 10000) / 100, schools };
}

async function one(school, output) {
  const folder = path.join(output, school.unitid);
  fs.mkdirSync(folder, { recursive: true });
  const warnings = [], requests = [];
  const result = { unitid: school.unitid, name: school.name, entry: school.entry,
    scope: school.scope, startedAt: new Date().toISOString(), container: process.env.HOSTNAME,
    docker: fs.existsSync('/.dockerenv'), status: 'error', complete: false };
  const warn = console.warn, error = console.error;
  console.warn = console.error = (...args) => warnings.push(args.join(' '));
  try {
    if (!school.entry) {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(school.probeUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        write(path.join(folder, 'unresolved-source.json'), { url: page.url(), title: await page.title(),
          text: (await page.locator('body').innerText()).slice(0, 35000),
          links: await page.locator('a[href]').evaluateAll(links => links.map(a => ({ text: a.innerText, url: a.href }))) });
        result.status = 'unresolved';
        result.reason = school.reason;
      } finally { await browser.close(); }
    } else {
      const ctx = makeHttpCtx();
      for (const method of ['fetchJson', 'fetchText', 'fetchResponse']) {
        const fetch = ctx[method];
        ctx[method] = async (url, options = {}) => {
          const request = { number: requests.length + 1, method, url: String(url), body: options.body || null };
          requests.push(request);
          try {
            const response = await fetch(url, { ...options, timeoutMs: 20000 });
            const value = method === 'fetchResponse' ? await response.clone().text() : response;
            const body = typeof value === 'string' ? value : JSON.stringify(value);
            request.file = `response-${request.number}.${method === 'fetchJson' ? 'json' : 'txt'}`;
            request.sha256 = sha(body);
            fs.writeFileSync(path.join(folder, request.file), body);
            return response;
          } catch (error) { request.error = error.message; throw error; }
          finally { write(path.join(folder, 'requests.json'), requests); }
        };
      }
      let jobs;
      const entry = school.entry;
      if (entry.provider === 'local-parser' && entry.parser?.script === 'browser-job-search.mjs') {
        const args = entry.parser.args;
        // A failed-only recovery invokes one() again in a separate output
        // directory. searchBrowserJobs creates a fresh browser/page and starts
        // pagination from its first page; no cursor from the failed attempt is
        // carried forward.
        const search = await searchBrowserJobs({ url: entry.careers_url, company: entry.name,
          kind: args[args.indexOf('--kind') + 1], maxPages: 200 });
        jobs = search.jobs;
        result.pagination = { pages: search.pages, reportedTotal: search.reportedTotal, complete: search.complete };
      } else {
        const providers = await loadProviders(path.join(codeRoot, 'providers'));
        const resolved = resolveProvider(entry, providers);
        if (!resolved?.provider) throw new Error(resolved?.error || 'No provider');
        jobs = await resolved.provider.fetch(entry, ctx);
        result.pagination = { requests: requests.length, complete: true };
      }
      result.status = classifySearch(jobs, warnings);
      result.postings = jobs.length;
      result.complete = true;
      write(path.join(folder, 'jobs.json'), jobs);
      result.jobsSha256 = sha(fs.readFileSync(path.join(folder, 'jobs.json')));
    }
  } catch (error) { result.reason = error.message; }
  finally {
    console.warn = warn; console.error = error;
    Object.assign(result, { warnings, requests: requests.length, finishedAt: new Date().toISOString() });
    write(path.join(folder, 'result.json'), result);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const usage = 'Usage: node container/validate-colleges.mjs --inventory FILE --output DIRECTORY [--concurrency 6] [--resume]\n       node container/validate-colleges.mjs --inventory FILE --output ORIGINAL --retry-failed --recovery-output NEW_DIRECTORY';
  validateFlags(args, ['--inventory', '--output', '--recovery-output', '--concurrency', '--school', '--resume', '--retry-failed', '--help', '-h'],
    usage,
    { valueFlags: ['--inventory', '--output', '--recovery-output', '--concurrency', '--school'], requireOperand: true });
  const { values } = parseArgs({ options: {
    inventory: { type: 'string' }, output: { type: 'string' }, 'recovery-output': { type: 'string' }, concurrency: { type: 'string', default: '6' },
    school: { type: 'string' }, resume: { type: 'boolean', default: false }, 'retry-failed': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  } });
  if (values.help) { console.log(usage); return; }
  if (!values.inventory || !values.output) throw new Error('Required: --inventory FILE --output DIRECTORY');
  if (!fs.existsSync('/.dockerenv')) throw new Error('Run this validation inside Docker');
  const inventoryText = fs.readFileSync(values.inventory, 'utf8');
  const inventory = JSON.parse(inventoryText);
  validateInventory(inventory);
  const output = path.resolve(values.output);
  if (values['retry-failed']) {
    if (!values['recovery-output']) throw new Error('--retry-failed requires --recovery-output so original receipts remain untouched');
    const recoveryOutput = path.resolve(values['recovery-output']);
    if (recoveryOutput === output || recoveryOutput.startsWith(output + path.sep) || output.startsWith(recoveryOutput + path.sep)) {
      throw new Error('Original and recovery output directories must be separate, non-nested paths');
    }
    const originalSummaryPath = path.join(output, 'summary.json');
    if (!fs.existsSync(originalSummaryPath)) throw new Error(`Original summary not found: ${originalSummaryPath}`);
    const originalText = fs.readFileSync(originalSummaryPath, 'utf8');
    const originalSummary = JSON.parse(originalText);
    if (originalSummary.inventorySha256 !== sha(inventoryText)) throw new Error('Inventory does not match the original run receipt');
    const failedIds = new Set(failedSchoolsForRetry(originalSummary, sha(inventoryText)).map(row => row.unitid));
    const retrySchools = inventory.schools.filter(row => failedIds.has(row.unitid));
    if (!retrySchools.length) throw new Error('Original validation has no incomplete failed schools to retry');
    if (fs.existsSync(recoveryOutput) && fs.readdirSync(recoveryOutput).length) {
      throw new Error('Recovery output directory already contains files; use a fresh directory');
    }
    fs.mkdirSync(recoveryOutput, { recursive: true });
    const startedAt = new Date().toISOString();
    const browserQueue = retrySchools.filter(s => !s.entry || s.entry.provider === 'local-parser');
    const nativeQueue = retrySchools.filter(s => s.entry && s.entry.provider !== 'local-parser');
    let completed = 0;
    async function retryWorker(queue) {
      while (queue.length) {
        const school = queue.shift();
        await new Promise(resolve => {
          execFile(process.execPath, [fileURLToPath(import.meta.url), '--inventory', path.resolve(values.inventory),
            '--output', recoveryOutput, '--school', school.unitid], { timeout: 660000, maxBuffer: 1000000 }, (error, stdout) => {
            if (error) {
              fs.mkdirSync(path.join(recoveryOutput, school.unitid), { recursive: true });
              write(path.join(recoveryOutput, school.unitid, 'result.json'), { unitid: school.unitid, name: school.name,
                status: 'error', complete: false, reason: 'Recovery subprocess failed or exceeded 11 minutes',
                finishedAt: new Date().toISOString(), docker: true });
            }
            console.log(`retry ${++completed}/${retrySchools.length} ${stdout.trim() || school.unitid + ' subprocess failed'}`);
            resolve();
          });
        });
      }
    }
    const concurrency = Number(values.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('concurrency must be 1..8');
    await Promise.all([...Array.from({ length: concurrency }, () => retryWorker(nativeQueue)),
      ...Array.from({ length: 2 }, () => retryWorker(browserQueue))]);
    const retried = retrySchools.map(school => {
      const file = path.join(recoveryOutput, school.unitid, 'result.json');
      return { ...JSON.parse(fs.readFileSync(file)), resultSha256: sha(fs.readFileSync(file)) };
    });
    write(path.join(recoveryOutput, 'summary.json'), { startedAt, finishedAt: new Date().toISOString(),
      inventorySha256: sha(inventoryText), sourceDatabaseSha256: inventory.sourceDatabaseSha256,
      docker: true, container: process.env.HOSTNAME, total: retried.length, schools: retried,
      originalSummary: { path: originalSummaryPath, sha256: sha(originalText) } });
    const overlayReceipt = buildCoverageOverlay(originalSummary, retried,
      { path: originalSummaryPath, sha256: sha(originalText) });
    overlayReceipt.recoverySummary = path.join(recoveryOutput, 'summary.json');
    overlayReceipt.inventorySha256 = sha(inventoryText);
    const overlayPath = path.join(recoveryOutput, 'overlay-summary.json');
    write(overlayPath, overlayReceipt);
    console.log(JSON.stringify({ retried: retrySchools.length, counts: overlayReceipt.counts, coveragePercent: overlayReceipt.coveragePercent,
      originalPreserved: true, overlay: overlayPath }));
    return;
  }
  if (values.school) {
    const school = inventory.schools.find(row => row.unitid === values.school);
    if (!school) throw new Error('Unknown UNITID');
    const result = await one(school, output);
    console.log(JSON.stringify({ unitid: result.unitid, status: result.status, postings: result.postings, reason: result.reason }));
    return;
  }
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('concurrency must be 1..8');
  fs.mkdirSync(output, { recursive: true });
  if (!values.resume && inventory.schools.some(school => fs.existsSync(path.join(output, school.unitid, 'result.json')))) {
    throw new Error('Output contains previous results; use a new directory or explicitly --resume');
  }
  const startedAt = new Date().toISOString();
  const queue = inventory.schools.filter(school => !values.resume || !fs.existsSync(path.join(output, school.unitid, 'result.json')));
  // Separate browser tasks from native provider traffic; extension callers share
  // their existing selected-tab lock. Every school is actually fetched, including
  // those with identical shared-employer routes.
  const browserQueue = queue.filter(s => !s.entry || s.entry.provider === 'local-parser');
  const nativeQueue = queue.filter(s => s.entry && s.entry.provider !== 'local-parser');
  let completed = 346 - queue.length;
  async function worker(queue) {
    while (queue.length) {
      const school = queue.shift();
      await new Promise(resolve => {
        execFile(process.execPath, [fileURLToPath(import.meta.url), '--inventory', path.resolve(values.inventory),
          '--output', output, '--school', school.unitid], { timeout: 660000, maxBuffer: 1000000 }, (error, stdout) => {
          if (error) {
            fs.mkdirSync(path.join(output, school.unitid), { recursive: true });
            write(path.join(output, school.unitid, 'result.json'), { unitid: school.unitid, name: school.name,
              status: 'error', complete: false, reason: 'Validation subprocess failed or exceeded 11 minutes',
              finishedAt: new Date().toISOString(), docker: true });
          }
          console.log(`${++completed}/346 ${stdout.trim() || school.unitid + ' subprocess failed'}`);
          resolve();
        });
      });
    }
  }
  await Promise.all([...Array.from({ length: concurrency }, () => worker(nativeQueue)),
    ...Array.from({ length: 2 }, () => worker(browserQueue))]);
  const schools = inventory.schools.map(school => {
    const file = path.join(output, school.unitid, 'result.json');
    return { ...JSON.parse(fs.readFileSync(file)), resultSha256: sha(fs.readFileSync(file)) };
  });
  const counts = Object.fromEntries(['working', 'empty', 'unresolved', 'error'].map(status => [status, schools.filter(s => s.status === status).length]));
  write(path.join(output, 'summary.json'), { startedAt, finishedAt: new Date().toISOString(),
    inventorySha256: sha(inventoryText), sourceDatabaseSha256: inventory.sourceDatabaseSha256,
    docker: true, container: process.env.HOSTNAME, total: schools.length, counts,
    coveragePercent: Math.round((counts.working + counts.empty) / schools.length * 10000) / 100, schools });
  console.log(JSON.stringify(counts));
}

if (isMainModule(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
