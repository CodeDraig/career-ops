#!/usr/bin/env node
import { isMainModule } from './lib/is-main-module.mjs';
import { mail } from './lib/mail/core.mjs';
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: node mail.mjs --request < request.json\nJSON actions: accounts, fetch, import, lead, prepare, history, review, send. See docs/MAIL.md.');
  } else {
    try {
      if (process.argv.slice(2).join(' ') !== '--request') throw new Error('Expected --request; see --help');
      let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 16_000_000) throw new Error('Request exceeds 16 MB'); }
      console.log(JSON.stringify(await mail(JSON.parse(input))));
    } catch (e) { console.error(JSON.stringify({ error: e.message })); process.exitCode = 1; }
  }
}
