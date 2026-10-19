// Explicit isolated Chromium test; no external network or user data.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {searchPeopleSoftBrowser} from '../peoplesoft-browser-search.mjs';
const browser=await chromium.launch();
try {
  let broken=false;
  const fake={newContext:async()=>{
    const context=await browser.newContext();const create=context.newPage.bind(context);
    context.newPage=async()=>{const p=await create();await p.route('https://college.example/**',r=>r.fulfill({contentType:'text/html',body:`<form name="win0"><div id="win0divHRS_AGNT_RSLT_Irowcnt$0">2 jobs found</div><ul id="grid"><li id="HRS_AGNT_RSLT_I$0_row_0"><a id="SCH_JOB_TITLE$0">First Faculty</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0">1</span></li></ul><div class="ps_box-more" style="display:none" onclick="${broken?'':'document.getElementById(\'grid\').insertAdjacentHTML(\'beforeend\',\'<li id=HRS_AGNT_RSLT_I$0_row_1><a id=SCH_JOB_TITLE$1>Second Faculty</a><span id=HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$1>2</span></li>\')'}" data-action="HRS_AGNT_RSLT_I"></div></form>`.replace('onclick="','onclick="/* HRS_AGNT_RSLT_I */ ')}));return p;};return context;
  }};
  const opts={url:'https://college.example/psc/HR/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?SiteId=1',company:'College'};
  const result=await searchPeopleSoftBrowser(opts,{browser:fake});assert.equal(result.jobs.length,2);assert.equal(result.pages,2);assert.ok(result.jobs.every(j=>j.url.includes('JobOpeningId=')));
  broken=true;await assert.rejects(searchPeopleSoftBrowser({...opts,maxPages:1},{browser:fake}),/page limit/);
  console.log('PASS PeopleSoft browser bootstrap, hidden load-more event, full totals, public links and capped-result rejection');
} finally {await browser.close();}
