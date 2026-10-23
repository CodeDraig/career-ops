#!/usr/bin/env node
import fs from 'node:fs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags, flagValue } from './lib/cli-flags.mjs';
import { automationStatus, configureAutomation, pauseAutomation, resumeAutomation, retryTask, listReviews, reviewAction } from './lib/automation/service.mjs';
import { runWorker } from './lib/automation/worker.mjs';
import { readConfig } from './lib/automation/store.mjs';

const USAGE = `Usage: node automation.mjs <command>
  worker [--once]                       Run the persistent worker or one tick
  status [--json]                       Show readiness, allocations and work
  config --file FILE                    Apply an explicit JSON settings patch
  pause | resume                        Stop or resume new automatic claims
  retry TASK_ID                         Retry blocked or failed work
  review list [--json]                   List open review items
  review show REVIEW_ID [--json]         Inspect a review item
  review resolve REVIEW_ID --revision N --action ACTION [--data FILE]

Review actions: reviewed, dismiss, retry, answer, match, approve_status, open_draft.
No command sends mail, submits an application, or automatically rewrites portals.`;

export async function request(input, root = getCareerOpsRoot()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('A JSON request object is required'), { status: 400 });
  if (input.action === 'status') return automationStatus(root);
  if (input.action === 'config') return input.patch === undefined ? readConfig(root) : configureAutomation(root, input.patch);
  if (input.action === 'reviews') return listReviews(root, input.filters || {});
  if (input.action === 'review') return input.payload ? reviewAction(root, input.id, input.payload) : listReviews(root, { id: input.id });
  if (input.action === 'pause') return pauseAutomation(root);
  if (input.action === 'resume') return resumeAutomation(root);
  if (input.action === 'retry') return retryTask(root, input.id);
  throw Object.assign(new Error('Unsupported automation action'), { status: 400 });
}

async function readRequest() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > 2_000_000) throw Object.assign(new Error('Automation request exceeds 2 MB'), { status: 413 });
  }
  return JSON.parse(text);
}

export async function main(argv = process.argv.slice(2), { root = getCareerOpsRoot(), output = value => process.stdout.write(value + '\n') } = {}) {
  validateFlags(argv, ['--once', '--json', '--request', '--file', '--revision', '--action', '--data', '--help', '-h'], USAGE, { valueFlags: ['--file', '--revision', '--action', '--data'], requireOperand: true });
  const [command, subcommand, id] = argv;
  let result;
  if (argv.length === 1 && command === '--request') result = await request(await readRequest(), root);
  else if (command === 'worker') {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once('SIGTERM', abort); process.once('SIGINT', abort);
    try { result = await runWorker(root, { once: argv.includes('--once'), signal: controller.signal, onError: error => process.stderr.write(`Automation: ${error.message}\n`) }); }
    finally { process.removeListener('SIGTERM', abort); process.removeListener('SIGINT', abort); }
  } else if (command === 'status') result = await automationStatus(root);
  else if (command === 'config') {
    const file = flagValue(argv, '--file');
    if (!file) throw new Error('config requires --file FILE');
    result = await configureAutomation(root, JSON.parse(fs.readFileSync(file, 'utf8')));
  } else if (command === 'pause') result = await pauseAutomation(root);
  else if (command === 'resume') result = await resumeAutomation(root);
  else if (command === 'retry' && subcommand && !subcommand.startsWith('-')) result = await retryTask(root, subcommand);
  else if (command === 'review' && subcommand === 'list') result = await listReviews(root);
  else if (command === 'review' && subcommand === 'show' && id && !id.startsWith('-')) result = await listReviews(root, { id });
  else if (command === 'review' && subcommand === 'resolve' && id && !id.startsWith('-')) {
    const file = flagValue(argv, '--data');
    const data = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    result = await reviewAction(root, id, { ...data, expectedRevision: Number(flagValue(argv, '--revision')), action: flagValue(argv, '--action') });
  } else throw new Error(USAGE);
  output(JSON.stringify(result, null, argv.includes('--json') ? 0 : 2));
  return result;
}

if (isMainModule(import.meta.url)) main().catch(error => {
  process.stderr.write(process.argv.includes('--request') ? JSON.stringify({ error: error.message, status: error.status || 400, ...(error.current ? { current: error.current } : {}) }) + '\n' : `${error.message}\n`);
  process.exitCode = 1;
});
