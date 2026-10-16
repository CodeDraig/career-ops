#!/usr/bin/env node
/** Chrome-extension-backed Indeed search/detail reads. No user-data writes. */
import { parseArgs } from 'node:util';
import { isMainModule } from './lib/is-main-module.mjs';
import { searchIndeed } from './lib/indeed.mjs';

export async function main(args = process.argv.slice(2)) {
  try {
    if (args.includes('--help') || args.includes('-h')) {
      console.log('Usage: node indeed-search.mjs --keywords "support engineer" --location Remote\n       node indeed-search.mjs --id <Indeed job key>\nReturns JSON. Uses the local browser-harness Chrome extension; searches never write user data.');
      return;
    }
    const { values } = parseArgs({ args, strict: true, options: {
      keywords: { type: 'string' }, location: { type: 'string' }, id: { type: 'string' },
    } });
    if (values.id && (values.keywords !== undefined || values.location !== undefined)) throw new Error('Use either --id or search keywords/location.');
    const result = await searchIndeed(values.id ? { action: 'job', id: values.id } : { keywords: values.keywords, location: values.location });
    console.log(JSON.stringify(result));
    if (!['ok', 'empty'].includes(result.status)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) await main();
