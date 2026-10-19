#!/usr/bin/env node
// Public PeopleSoft Fluid search fallback for boards requiring browser bootstrap.
// Uses the same row parser and public detail URLs as the HTTP provider.
import {chromium} from 'playwright';
import {parseSearchPage,resolveConfig,buildDetailUrl} from './providers/peoplesoft.mjs';
import {rejectPrivateOrInvalid} from './liveness-browser.mjs';
import {isMainModule} from './lib/is-main-module.mjs';
import {validateFlags,flagValue} from './lib/cli-flags.mjs';
export async function searchPeopleSoftBrowser({url,company,family,maxPages=100},{browser:suppliedBrowser}={}){
  if(rejectPrivateOrInvalid(url)||!company?.trim())throw new Error('A public careers URL and company are required');
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw new Error('maxPages must be 1..100');
  const origin=new URL(url).origin,browser=suppliedBrowser||await chromium.launch();
  const context=await browser.newContext();
  try{
    await context.route('**/*',r=>rejectPrivateOrInvalid(r.request().url())?r.abort():r.continue());
    const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    const latest=page.getByRole('link',{name:'View Latest Jobs',exact:true});
    if(await latest.count())await latest.click();
    await page.locator('[id="HRS_AGNT_RSLT_I$0_row_0"]').waitFor({timeout:30000});
    if(family){
      const escaped=family.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const facet=page.getByRole('checkbox',{name:new RegExp(`^Apply ${escaped} \\(\\d+\\) filter$`)});
      const count=Number((await facet.getAttribute('aria-label')).match(/\((\d+)\)/)[1]);
      await facet.click();
      await page.waitForFunction(count=>document.body.innerText.includes(`${count} jobs found`),count,{timeout:30000});
    }
    const config=resolveConfig({careers_url:page.url()});
    if(!config||new URL(page.url()).origin!==origin)throw new Error('PeopleSoft search left the employer or is unrecognized');
    const jobs=new Map();let previousCount=-1;
    for(let n=1;n<=maxPages;n++){
      let state;const deadline=Date.now()+30000;
      do{state=parseSearchPage(await page.content(),config);if(state.valid&&state.rows.length>previousCount)break;await page.waitForTimeout(250);}while(Date.now()<deadline);
      if(!state.valid||state.reportedTotal===null)throw new Error('PeopleSoft search is missing a recognized result count');
      for(const row of state.rows)jobs.set(row.jobId,{title:row.title,url:buildDetailUrl(config,row.jobId,1),company,location:row.location});
      if(state.rows.length>=state.reportedTotal)return {jobs:[...jobs.values()],pages:n,complete:true,reportedTotal:state.reportedTotal,rawRows:state.rows.length,source:url,family};
      if(state.rows.length<=previousCount)throw new Error('PeopleSoft pagination stopped before its total');
      previousCount=state.rows.length;
      await page.locator('.ps_box-more[onclick*="HRS_AGNT_RSLT_I"]').dispatchEvent('click',{timeout:10000});
    }
    throw new Error('PeopleSoft exceeded page limit; incomplete results were not emitted');
  }finally{await context.close();if(!suppliedBrowser)await browser.close();}
}
if(isMainModule(import.meta.url)){
  const args=process.argv.slice(2);validateFlags(args,['--url','--company','--family','--help','-h'],'node peoplesoft-browser-search.mjs --url URL --company NAME [--family Adjunct]',{valueFlags:['--url','--company','--family'],requireOperand:true});
  try{console.log(JSON.stringify(await searchPeopleSoftBrowser({url:flagValue(args,'--url'),company:flagValue(args,'--company'),family:flagValue(args,'--family')})));}catch(e){console.error(e.message);process.exitCode=1;}
}
