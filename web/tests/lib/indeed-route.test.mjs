import '../helpers/web-ts-alias-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { POST } = await import('../../src/app/api/explore/indeed/route.ts');
const { addOffersToPipeline } = await import('../../src/lib/core/pipeline.ts');
const root = path.resolve(import.meta.dirname,'../../..');
const send = body => POST(new Request('http://localhost/api/explore/indeed',{method:'POST',body:JSON.stringify(body)}));
test('Indeed route rejects malformed and invalid requests before launching a browser',async()=>{
  for(const body of [{},[],{action:'job',id:'bad'},{keywords:'x',location:4},{keywords:'x',action:'submit'}]) assert.equal((await send(body)).status,400);
  assert.equal((await POST(new Request('http://localhost',{method:'POST',body:'{'}))).status,400);
});
test('Indeed route calls real core with a separate data root and delegates explicit additions',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'career-ops-indeed-route-'));
  const fake=path.join(dir,'harness');
  const before={...process.env};
  fs.mkdirSync(path.join(dir,'data'));
  const initial='## Test inbox\n';fs.writeFileSync(path.join(dir,'data/pipeline.md'),initial);
  fs.writeFileSync(fake,`#!/usr/bin/env node
let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
if(process.env.BH_BACKEND!=='extension')process.exit(3);
const b=input.match(/b64decode\\('([^']+)'\\)/)[1];const request=JSON.parse(Buffer.from(b,'base64'));
const u=new URL(request.url);
const status=u.searchParams.get('q')==='blocked'?'challenge':'ok';
const output=u.pathname==='/viewjob'?{status,url:request.url,title:'Support',description:'Fixture description',closed:false}:{status,url:request.url,jobs:[{id:'0123456789abcdef',title:u.searchParams.get('q'),company:'Fixture',location:'Remote'}]};
console.log('CAREER_OPS_INDEED='+JSON.stringify(output));});
`,{mode:0o700});
  try {
    process.env.TMPDIR=dir;process.env.TEMP=dir;process.env.TMP=dir;process.env.CAREER_OPS_ROOT=dir;process.env.CAREER_OPS_CODE_ROOT=root;process.env.CAREER_OPS_BROWSER_HARNESS_BIN=fake;
    const response=await send({keywords:'--looks-like-a-flag',location:'Remote'});assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.offers[0].title,'--looks-like-a-flag');assert.equal(result.offers[0].verification,'unconfirmed');
    assert.equal(fs.readFileSync(path.join(dir,'data/pipeline.md'),'utf8'),initial);
    const detail=await send({action:'job',id:'0123456789abcdef'});assert.equal((await detail.json()).description,'Fixture description');
    const blocked=await send({keywords:'blocked'});assert.equal(blocked.status,503);assert.equal((await blocked.json()).status,'challenge');
    const added=await addOffersToPipeline(result.offers);assert.equal(added.added,1,added.error);
    assert.match(fs.readFileSync(path.join(dir,'data/pipeline.md'),'utf8'),/0123456789abcdef/);
    assert.match(fs.readFileSync(path.join(dir,'data/pipeline.md'),'utf8'),/employer opening not yet verified/);
    assert.match(fs.readFileSync(path.join(dir,'data/scan-history.tsv'),'utf8'),/0123456789abcdef/);
  } finally {for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);fs.rmSync(dir,{recursive:true,force:true});}
});
