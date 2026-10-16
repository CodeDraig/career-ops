import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const savedTmp = process.env.TMPDIR;
const testTmp = mkdtempSync(path.join(os.tmpdir(), 'indeed-unit-'));
process.env.TMPDIR = testTmp;
import { pass, fail, ROOT } from './helpers.mjs';
import { indeedRequest, normalizeIndeed, searchIndeed } from '../lib/indeed.mjs';
import { browserHarnessProgram, browserHarnessBinary, readIndeed } from '../lib/browser-harness/runner.mjs';
import { extractIndeedPage } from '../lib/browser-harness/indeed-extract.mjs';
const id = '0123456789abcdef';
const request = indeedRequest({keywords: 'support engineer', location: 'Remote'});
const raw = {status:'ok', url:request.url, jobs:[{id,title:'Support Engineer',company:'Example',location:'Remote'}]};
async function check(name, fn) { try { await fn(); pass(name); } catch(e) { fail(`${name}: ${e.message}`); } }
await check('CLI help exits without opening a browser', () => {
  for (const flag of ['--help','-h']) assert.match(execFileSync(process.execPath,[`${ROOT}/indeed-search.mjs`,flag],{encoding:'utf8',env:{...process.env,CAREER_OPS_BROWSER_HARNESS_BIN:'/missing'}}),/^Usage:/);
});
await check('Indeed inputs stay URL data and reject invalid requests', () => {
  const url = new URL(indeedRequest({keywords: '--x=";print(42) #',location:'Remote & UK'}).url);
  assert.equal(url.searchParams.get('q'), '--x=";print(42) #');
  assert.equal(url.searchParams.get('l'), 'Remote & UK');
  for (const input of [null,[],{}, {keywords:'x',action:'apply'}, {action:'job',id:'../x'}, {keywords:'x',location:[]}, {keywords:'x'.repeat(201)}]) assert.throws(() => indeedRequest(input));
});
await check('Indeed normalization deduplicates and preserves unconfirmed provenance', () => {
  const result=normalizeIndeed({...raw,jobs:[...raw.jobs,...raw.jobs,{id:'bad',title:'Bad'},{id:1234567890123456,title:'Numeric'}]},request);
  assert.equal(result.offers.length,1);assert.equal(result.offers[0].verification,'unconfirmed');
  assert.equal(result.offers[0].url,`https://www.indeed.com/viewjob?jk=${id}`);
  assert.match(result.warnings.join(' '),/omitted/);
});
await check('Indeed caps output and distinguishes failure from explicit empty', () => {
  assert.equal(normalizeIndeed({...raw,jobs:[]},request).status,'unavailable');
  assert.equal(normalizeIndeed({...raw,status:'empty',jobs:[]},request).status,'empty');
  assert.equal(normalizeIndeed({...raw,jobs:Array.from({length:60},(_,i)=>({id:i.toString(16).padStart(16,'0'),title:'Job'}))},request).offers.length,50);
  for(const status of ['challenge','login_required','unsupported_browser','busy','browser_unavailable','not_configured']) assert.equal(normalizeIndeed({status},request).status,status);
});
await check('Indeed rejects redirected identities and silently dropped search filters', () => {
  for(const url of ['https://example.com/jobs?q=support+engineer&l=Remote', 'https://www.indeed.com/jobs?q=support+engineer', 'https://www.indeed.com/']) assert.equal(normalizeIndeed({...raw,url},request).status,'unavailable');
  const job=indeedRequest({action:'job',id});
  assert.equal(normalizeIndeed({status:'ok',url:job.url,description:'Actual JD',closed:true},job).closed,true);
  assert.equal(normalizeIndeed({status:'ok',url:job.url,description:'',closed:true},job).closed,true);
  assert.equal(normalizeIndeed({status:'ok',url:job.url.replace(id,'ffffffffffffffff'),description:'Wrong JD'},job).status,'unavailable');
});
function extract({text='',title='',pathname='/jobs',hostname='www.indeed.com',query=()=>null,cards=[],results=[]}={}) {
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${extractIndeedPage.toString()})()`, {
    location:{hostname,pathname,href:request.url},window:{mosaic:{providerData:{'mosaic-provider-jobcards':{metaData:{mosaicProviderJobCardsModel:{results}}}}}},
    document:{title,body:{innerText:text},querySelector:query,querySelectorAll:()=>cards}
  })));
}
await check('Extractor detects challenge/login/loading/empty distinctly', () => {
  assert.equal(extract({title:'Just a moment'}).status,'challenge');
  assert.equal(extract({hostname:'accounts.indeed.com'}).status,'login_required');
  assert.equal(extract().status,'unavailable');
  assert.equal(extract({text:'No jobs found'}).status,'empty');
});
await check('Extractor includes only rendered cards, not hidden recommendations', () => {
  const card={getAttribute:()=>id,innerText:'Engineer',closest:()=>null};
  const result=extract({cards:[card],results:[{jobkey:id,company:'Example',formattedLocation:'Remote'},{jobkey:'ffffffffffffffff',title:'Hidden'}]});
  assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].company,'Example');
  assert.equal(extract({results:[{jobkey:id,title:'Hidden'}]}).status,'unavailable');
});
await check('Both Indeed detail layouts return raw JD and closure evidence', () => {
  const expired = extract({pathname:'/viewjob',text:'This job has expired'});
  assert.equal(expired.status,'ok');assert.equal(expired.closed,true);assert.equal(expired.description,'');
  for (const selector of ['#jobDescriptionText','.simple-job-description-html']) {
    const result=extract({pathname:'/viewjob',text:'This job has expired',query:s=>s.includes(selector)?{innerText:'Full\nJD'}:{innerText:'Title'}});
    assert.equal(result.description,'Full\nJD');assert.equal(result.closed,true);
  }
});
await check('Runner forces extension mode and sends data on stdin from code root', async () => {
  let sent;
  const result=await readIndeed(request.url,{env:{CAREER_OPS_BROWSER_HARNESS_BIN:'/fake/harness',BH_BACKEND:'cdp',BU_NAME:'wrong',BH_DOMAIN_SKILLS:'1'},execute:(bin,args,options,done)=>{
    assert.equal(bin,'/fake/harness'); assert.deepEqual(args,[]);assert.equal(options.env.BH_BACKEND,'extension');assert.equal(options.env.BU_NAME,'career-ops');assert.equal(options.env.BH_DOMAIN_SKILLS,'0');assert.equal(options.cwd.replace(/\/$/,''),ROOT);
    return {stdin:{on(){},end(code){sent=code;done(null,'log\nCAREER_OPS_INDEED='+JSON.stringify(raw));}}};
  }});
  assert.equal(result.status,'ok');assert.ok(sent.includes("base64.b64decode"));
  assert.equal(browserHarnessBinary({CAREER_OPS_BROWSER_HARNESS_BIN:'/custom/bin'}),'/custom/bin');
});
await check('Runner reports missing executable and malformed output without leaking logs', async () => {
  for(const [error,stdout,expected] of [[{code:'ENOENT'},'secret','not_configured'],[null,'bad secret','browser_unavailable']]) {
    const result=await readIndeed(request.url,{execute:(_b,_a,_o,done)=>({stdin:{on(){},end(){done(error,stdout);}}})});
    assert.deepEqual(result,{status:expected});
  }
});
await check('Concurrent adapter reads cannot drive selected tab simultaneously', async () => {
  let complete,started;
  const ready=new Promise(resolve=>started=resolve);
  const first=readIndeed(request.url,{execute:(_b,_a,_o,done)=>({stdin:{on(){},end(){complete=()=>done(null,'CAREER_OPS_INDEED='+JSON.stringify(raw));started();}}})});
  await ready;
  try { assert.equal((await readIndeed(request.url,{execute:()=>{throw Error('must not launch');}})).status,'busy'); }
  finally { complete(); await first; }
});
await check('Python bridge uses Chrome extension, closes only owned successful tab', () => {
  const program=browserHarnessProgram(request.url);
  const harness=`import json\ncalls=[]\nbrowser_capabilities=lambda: {'backend':'extension','browser':'chrome','js':True}\nnew_tab=lambda url: calls.append(['new',url]) or '123'\nswitch_tab=lambda target: calls.append(['switch',target])\ncurrent_tab=lambda: {'targetId':'123'}\njs=lambda expression: {'status':'ok','url':${JSON.stringify(request.url)},'jobs':[]}\nclose_tab=lambda target: calls.append(['close',target])\n`;
  const output=execFileSync('python3',['-c',harness+program+"\nprint(json.dumps(calls))"],{encoding:'utf8'});
  const calls=JSON.parse(output.trim().split('\n').at(-1));assert.deepEqual(calls,[['new',request.url],['switch','123'],['close','123']]);
  const challenge=execFileSync('python3',['-c',harness.replace("'status':'ok'","'status':'challenge'")+program+"\nprint(json.dumps(calls))"],{encoding:'utf8'});
  assert.ok(!challenge.includes('["close"'));
  const firefox=execFileSync('python3',['-c',harness.replace("'browser':'chrome'","'browser':'firefox'")+program+"\nprint(json.dumps(calls))"],{encoding:'utf8'});
  assert.match(firefox,/unsupported_browser/);assert.equal(firefox.trim().split('\n').at(-1),'[]');
});
await check('Interactive router and updater ship Indeed without profile writes', () => {
  for(const file of ['indeed-search.mjs','modes/indeed.md','lib/indeed.mjs','lib/browser-harness/']) assert.ok(readFileSync(`${ROOT}/update-system.mjs`,'utf8').includes(`'${file}'`));
  assert.match(readFileSync(`${ROOT}/modes/indeed.md`,'utf8'),/aggregator employer-confirmation/);
});
await check('Search delegates only validated URL to adapter',async()=>{
  const result=await searchIndeed({keywords:'support engineer',location:'Remote'},{read:async url=>{assert.equal(url,request.url);return raw;}});
  assert.equal(result.offers.length,1);
});

if (savedTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = savedTmp;
rmSync(testTmp, {recursive:true,force:true});
