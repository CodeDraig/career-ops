# Original 172 college search routes: ownership and pagination

**Latest coverage:** the [remaining-school validation](COLLEGE_REMAINING_VALIDATION.md) raises the combined total to **338/346 (97.7%)**. Counts below describe this earlier pass.

Validated **2026-10-19**. All **172/172** now have a completed search on a board
belonging to the institution, its shared employing district/system, or its documented
successor. **171 returned postings; Snead State returned an explicit empty result.**
Shared boards and successor routes are identified below; they do not establish
that every posting belongs to the named campus.

Combined with the previous [60-school validation](COLLEGE_SEARCHES.md), current
successful route coverage is **231/346 = 66.8%**: **229 non-empty searches and 2
validated empty searches**. **115 schools remain unresolved**, including Galen/HCA.
The percentage is unchanged: this work replaces provisional reachability evidence
for the original 172 with ownership and pagination checks. The other 174 schools
were not re-tested in this pass.

## What was corrected

- NEOGOV posting-date ties omitted records at page boundaries. Searches now use
  title order, attempt one reverse-order recovery pass when the advertised total
  exposes a gap, and fail if the unique inventory remains incomplete. Bounded
  one-page health probes remain probes, not completeness claims.
- Institution/campus filters now narrow statewide/system searches for Jefferson,
  Snead, Front Range, CSU Pueblo, LSU-Shreveport, Gwinnett, Normandale, Cincinnati's
  three campuses, Contra Costa, Diablo Valley, San Diego City/Miramar, South Dakota,
  Northern Virginia, Tidewater, Bakersfield, Coastline and Golden West.
- Workday keeps explicit `workday.applied_facets` on every page and when splitting
  oversized searches. USC now uses its external careers board; Texas A&M uses
  its own external board rather than the system-wide inventory.
- SuccessFactors uses the current `date` sort value, preserves
  `successfactors.facet_filters`, and calls the root API with the page's brand.
  Purdue Global is brand-scoped. The main Purdue entry remains explicitly shared.
- BMCC uses its own published vacancy list rather than the whole CUNY Research
  Foundation board. Its browser recipe includes the official PDF/Word vacancies.
- Clovis uses its actual State Center NEOGOV board, not an incorrectly inferred
  PeopleAdmin endpoint. Northcentral is explicitly a National University successor
  route following the [documented merger](https://www.nu.edu/national-and-northcentral-have-merged/).
- The browser search script is registered in the system updater's file manifest;
  the full test suite detected that missing registration.

## Meaning and limits of validation

Ownership used employer-branded boards, employer text in sample descriptions,
observed institution/campus facets, and official referral pages. A provider's
assigned `company` field is not ownership evidence. Shared district entries are
labelled in both the table and example entry names to avoid presenting every job
as belonging to a single campus. Blinn's direct institutional HTTP fetches failed;
its [official employment referral](https://www.blinn.edu/EmploymentSite.html) was
read through the web tool and points to the live, fully paginated CSOD board.

Completeness means all pages of the **configured public site**: distinct records
reconciled with the advertised API/HTML total, or a terminal pagination response
where no total is exposed. Workday occasionally returns empty source objects
without a title or URL; the ledger records these separately from usable postings.
Counts are a dated snapshot of changing remote systems, not an atomic census.
A faculty-only, part-time, management or shared-system board does not cover every
other recruitment site an institution may operate. These are not counts of
remote-adjunct vacancies, and shared inventories must not be summed as unique jobs.
No claim is made about every job description or application submission.

## Configuration and evidence

Use [the 172-entry example](../templates/college-provider-portals.example.yml)
alongside the separate 60-entry example. Neither loads automatically. Merge desired
entries into `tracked_companies` in your data root's `portals.yml`, preserving your
filters; this validation did not modify live configuration or the source database.
Explicit Workday/SAP facet settings are essential to the scoped routes.

The [machine-readable ledger](college-provider-validation-2026-10-19.json) records
all 172 UNITIDs, counts, scope, ownership excerpts, pagination receipts and hashes.
Raw HTTP responses, per-request traces, the probe/analyzer scripts, and full test
logs are retained in `~/Downloads/college-provider-validation-2026-10-19/`.
The original audit and before-scoping configurations are retained there or in the
original audit directory. Native probes called each installed provider's `fetch`
with `max_pages: 200`, without title/location/date filters; BMCC ran
`node browser-job-search.mjs --url https://www.bmcc.cuny.edu/job-opportunities/ --company BMCC --kind bmcc`.
The table reports the final corrected routes, not superseded broad-board results.

## Verification and preservation

- `node test-all.mjs`: **12,861 passed, 0 failed, 9 warnings** after registering
  `browser-job-search.mjs` with the updater. The initial run's single failure was
  that missing registration. The full run also compiled the dashboard.
- The new 172-entry configuration check and the expanded institution-preserving
  Workday partition regression were run separately after their final edits; both
  passed. NEOGOV recovery/count regressions and SuccessFactors tests passed.
- `node tests/browser-job-search.integration.mjs`: passed with real Chromium and
  fixture pages; the live BMCC search separately returned 21 entries.
- Syntax, updater-manifest coverage, evidence hashes, and `git diff --check` passed.
- Warnings: missing personal CV data (1), existing “Santiago” strings in CI files
  (6), and optional H1B API/token-mint tests not enabled (2). Those two external
  H1B checks were not run. Separate web and dashboard Go test suites were not run
  because this change does not edit web/Go sources.
- No live profile, CV, tracker, portal configuration, or college database changed.
  The source database SHA-256 remains
  `913b31191a624b65fe72c8fb858ffaffc9719aa1125f66062315bd89afe4276e`.

## Per-school results

| UNITID | School | Postings | Scope | Pagination |
|---|---|---:|---|---|
| 100663 | [University of Alabama at Birmingham](https://uab.peopleadmin.com/postings/search) | 418 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 14 pages; final page has no next-page link |
| 101505 | [Jefferson State Community College](https://www.schooljobs.com/careers/accs/jefferson) | 3 | Jefferson State institutional folder; excludes other Alabama colleges | 2 requests; 3/3 unique advertised postings |
| 102076 | [Snead State Community College](https://www.schooljobs.com/careers/accs/sneadstate) | 0 | Snead State institutional folder; explicit zero-job response | 1 requests; 0/0 unique advertised postings |
| 102094 | [University of South Alabama](https://southalabama.peopleadmin.com/postings/search) | 41 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 pages; final page has no next-page link |
| 102368 | [Troy University](https://www.troyuniversityjobs.com/postings/search) | 213 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 8 pages; final page has no next-page link |
| 104717 | [Grand Canyon University](https://gcu.wd1.myworkdayjobs.com/GCU) | 259 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 13 listing pages, 259/259 raw records; 0 source records lack title/URL |
| 105525 | [Pima Community College](https://www.schooljobs.com/careers/pimacc) | 23 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 requests; 23/23 unique advertised postings |
| 105668 | [Rio Salado College](https://jobs.erp.maricopa.edu/psc/MCPAHPRD/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_JBPST_FL&Action=U&FOCUS=Applicant&SiteId=1000&JobOpeningId=322706&PostingSeq=1) | 300 | Maricopa district board; Rio Salado is a member; other colleges included | 6 search responses; 300/300 rows |
| 109350 | [Antelope Valley Community College District](https://www.schooljobs.com/careers/avc) | 140 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 15 requests; 140/140 unique advertised postings |
| 109819 | [Bakersfield College](https://www.schooljobs.com/careers/kccd?department=Bakersfield+College) | 128 | Bakersfield College department only; excludes other Kern colleges and district office | 14 requests; 128/128 unique advertised postings |
| 110219 | [Bryan University](https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=d8572d2b-993f-4042-9138-81763f4d149e&ccId=19000101_000001&lang=en_US) | 7 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 API pages; 7/7 requisitions |
| 111461 | [College of the Canyons](https://schooljobs.com/careers/canyons) | 108 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 12 requests; 108/108 unique advertised postings |
| 111939 | [Chaffey College](https://www.schooljobs.com/careers/chaffey) | 10 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 requests; 10/10 unique advertised postings |
| 112172 | [Citrus College](https://employment.citruscollege.edu/postings/search) | 110 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 pages; final page has no next-page link |
| 112190 | [City College of San Francisco](https://jobs.ccsf.edu/postings/search) | 33 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 pages; final page has no next-page link |
| 112385 | [Coastline Community College](https://www.schooljobs.com/careers/cccd?department=Coastline+Community+College) | 3 | Coastline department on classified/management board; faculty recruiting may use another board | 2 requests; 3/3 unique advertised postings |
| 112826 | [Contra Costa College](https://www.4cdcareers.net/postings/search?449%5B%5D=3) | 3 | Contra Costa College campus filter 449[]=3 | 1 pages; final page has no next-page link |
| 113193 | [Cuesta College](https://www.schooljobs.com/careers/cuesta) | 29 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 requests; 29/29 unique advertised postings |
| 113573 | [College of the Desert](https://www.schooljobs.com/careers/collegeofthedesertca) | 17 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 requests; 17/17 unique advertised postings |
| 113634 | [Diablo Valley College](https://www.4cdcareers.net/postings/search?449%5B%5D=4) | 13 | Diablo Valley campus filter 449[]=4 | 1 pages; final page has no next-page link |
| 114266 | [Evergreen Valley College](https://sjeccd.peopleadmin.com/postings/search) | 32 | San Jose–Evergreen district board; Evergreen Valley and San Jose City included | 2 pages; final page has no next-page link |
| 114716 | [Foothill College](https://www.schooljobs.com/careers/fhda) | 170 | Foothill–De Anza district board; both colleges and district jobs included | 18 requests; 170/170 unique advertised postings |
| 115126 | [Golden West College](https://www.schooljobs.com/careers/cccd?department=Golden+West+College) | 5 | Golden West department on classified/management board; faculty recruiting may use another board | 2 requests; 5/5 unique advertised postings |
| 117247 | [Laney College](https://www.schooljobs.com/careers/peralta) | 56 | Peralta district board; Laney and the other district colleges included | 7 requests; 56/56 unique advertised postings |
| 117645 | [Long Beach City College](https://www.schooljobs.com/careers/lbcc) | 16 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 requests; 16/16 unique advertised postings |
| 118718 | [Merced College](https://www.schooljobs.com/careers/mccd) | 1 | Merced management careers board | 2 requests; 1/1 unique advertised postings |
| 118976 | [Modesto Junior College](https://yosemite.peopleadmin.com/postings/search) | 57 | Yosemite district board; Modesto and Columbia included | 2 pages; final page has no next-page link |
| 119137 | [Moorpark College](https://www.schooljobs.com/careers/vcccd) | 78 | Ventura County district board; Moorpark, Oxnard, Ventura and district jobs included | 9 requests; 78/78 unique advertised postings |
| 119164 | [Mt San Antonio College](https://hrjobs.mtsac.edu/postings/search) | 130 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 pages; final page has no next-page link |
| 119605 | [National University](https://nus.wd1.myworkdayjobs.com/en-US/Careers) | 55 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 listing pages, 55/55 raw records; 0 source records lack title/URL |
| 120971 | [Palomar College](https://palomar.peopleadmin.com/postings/search) | 86 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 pages; final page has no next-page link |
| 121044 | [Pasadena City College](https://www.schooljobs.com/careers/pasadenaedu) | 11 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 requests; 11/11 unique advertised postings |
| 121886 | [Rio Hondo College](https://riohondo.peopleadmin.com/postings/search) | 42 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 pages; final page has no next-page link |
| 122205 | [Saddleback College](https://www.schooljobs.com/careers/socccd) | 43 | South Orange County district board; Saddleback and Irvine Valley included | 6 requests; 43/43 unique advertised postings |
| 122339 | [San Diego City College](https://www.sdccdjobs.com/postings/search?query_organizational_tier_2_id%5B%5D=6) | 3 | San Diego City organizational tier 2 = 6 | 1 pages; final page has no next-page link |
| 122384 | [San Diego Miramar College](https://www.sdccdjobs.com/postings/search?query_organizational_tier_2_id%5B%5D=266) | 3 | San Diego Miramar organizational tier 2 = 266 | 1 pages; final page has no next-page link |
| 122658 | [San Joaquin Delta College](https://www.schooljobs.com/careers/deltacollege) | 84 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 10 requests; 84/84 unique advertised postings |
| 122889 | [Santa Barbara City College](https://www.schooljobs.com/careers/sbcc) | 9 | Santa Barbara administrator/classified/management careers board | 2 requests; 9/9 unique advertised postings |
| 123013 | [Santa Rosa Junior College](https://www.schooljobs.com/careers/santarosajc) | 120 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 13 requests; 120/120 unique advertised postings |
| 123341 | [Sierra College](https://www.schooljobs.com/careers/sierracollege) | 5 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 requests; 5/5 unique advertised postings |
| 123527 | [San Bernardino Valley College](https://www.schooljobs.com/careers/sbccd) | 223 | San Bernardino district board; Valley and Crafton Hills included | 24 requests; 223/223 unique advertised postings |
| 123961 | [University of Southern California](https://usc.wd5.myworkdayjobs.com/ExternalUSCCareers) | 689 | USC ExternalUSCCareers; replaces Advancement-only board | 35 listing pages, 690/690 raw records; 1 source records lack title/URL |
| 125028 | [Ventura College](https://www.schooljobs.com/careers/vcccd) | 78 | Ventura County district board; same inventory as Moorpark | 9 requests; 78/78 unique advertised postings |
| 125091 | [Victor Valley College](https://www.schooljobs.com/careers/vvc) | 95 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 11 requests; 95/95 unique advertised postings |
| 126818 | [Colorado State University-Fort Collins](https://csusystem.wd12.myworkdayjobs.com/en-US/fortcollins_careers/job/Adjunct-Faculty--Department-of-Accounting---Open-Pool_R2026105157) | 283 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 15 listing pages, 283/283 raw records; 0 source records lack title/URL |
| 127200 | [Front Range Community College](https://www.governmentjobs.com/careers/colorado?department[0]=Front%20Range%20Community%20College) | 4 | Front Range department on Colorado state board | 2 requests; 4/4 unique advertised postings |
| 127565 | [Metropolitan State University of Denver](https://msudenver.wd1.myworkdayjobs.com/MSUDenver) | 124 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 7 listing pages, 124/124 raw records; 0 source records lack title/URL |
| 128106 | [Colorado State University Pueblo](https://www.governmentjobs.com/careers/colorado?department[0]=Colorado%20State%20University%20Pueblo) | 2 | CSU Pueblo department on Colorado state board | 2 requests; 2/2 unique advertised postings |
| 132709 | [Broward College](https://browardcollege.wd5.myworkdayjobs.com/en-US/PT/job/Adjunct-Faculty--Math--Pooled-Position--Central-Campus-_REQ-000048832-1) | 113 | Broward PT public board | 6 listing pages, 113/113 raw records; 0 source records lack title/URL |
| 132903 | [University of Central Florida](https://ucf.wd1.myworkdayjobs.com/en-US/careers/job/Adjunct--College-of-Science_R113365) | 96 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 listing pages, 96/96 raw records; 0 source records lack title/URL |
| 133386 | [Daytona State College](https://www.schooljobs.com/careers/daytonastate) | 110 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 12 requests; 110/110 unique advertised postings |
| 133669 | [Florida Atlantic University](https://fau.wd1.myworkdayjobs.com/en-US/FAU/job/Nursing-Adjuncts_REQ21767) | 52 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 listing pages, 52/52 raw records; 0 source records lack title/URL |
| 133881 | [Florida Institute of Technology](https://floridatech.wd5.myworkdayjobs.com/en-US/FloridaTechCareers/job/Adjunct-Faculty-Orlando_R7840) | 43 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 listing pages, 43/43 raw records; 0 source records lack title/URL |
| 134097 | [Florida State University](https://jobs.omni.fsu.edu/psc/sprdhr_er/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?FOCUS=Applicant&Page=HRS_APP_SCHJOB&Action=U&SiteId=1&) | 234 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 search responses; 234/234 rows |
| 134237 | [Full Sail University](https://fullsail.wd1.myworkdayjobs.com/en-US/External/job/Adjunct-Faculty---Creative-Writing_R00011724) | 79 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 listing pages, 79/79 raw records; 0 source records lack title/URL |
| 134495 | [Hillsborough College](https://hcfl.wd1.myworkdayjobs.com/en-US/hcjobs?jobFamilyGroup=e866224a84421001b00d5c2cc09b0000) | 160 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 8 listing pages, 160/160 raw records; 0 source records lack title/URL |
| 134608 | [Indian River State College](https://irsc.wd5.myworkdayjobs.com/en-US/External/job/Adjunct-Human-Services_R5576) | 121 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 7 listing pages, 121/121 raw records; 0 source records lack title/URL |
| 136516 | [Polk State College](https://www.schooljobs.com/careers/polkstate) | 39 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 requests; 39/39 unique advertised postings |
| 137032 | [Saint Leo University](https://saintleo.wd503.myworkdayjobs.com/en-US/SLU/job/Adjunct---Social-Work_R4244) | 71 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 listing pages, 71/71 raw records; 0 source records lack title/URL |
| 137351 | [University of South Florida](https://fa-ewkd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/USF/jobs) | 236 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 API pages; 236/236 jobs |
| 137759 | [Tallahassee State College](https://tscfl.wd12.myworkdayjobs.com/en-US/TSC_External_Career_Site/jobs?q=adjunct) | 35 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 listing pages, 35/35 raw records; 0 source records lack title/URL |
| 139940 | [Georgia State University](https://facultycareers.gsu.edu/postings/search) | 99 | Georgia State faculty public board | 4 pages; final page has no next-page link |
| 140012 | [Gwinnett Technical College](https://georgia.wd5.myworkdayjobs.com/TGC/job/Lawrenceville/Adjunct-Faculty---Degree-Level-Mathematics_JR0000001276) | 63 | Gwinnett Technical hiringCompany facet on Georgia state board | 4 listing pages, 64/64 raw records; 1 source records lack title/URL |
| 142522 | [Brigham Young University-Idaho](https://wd501.myworkdaysite.com/recruiting/byui/BYU-Idaho_Faculty_Opportunities) | 52 | BYU-Idaho faculty opportunities | 3 listing pages, 52/52 raw records; 0 source records lack title/URL |
| 146472 | [College of Lake County](https://clc.wd115.myworkdayjobs.com/en-US/External/job/Adjunct-Faculty--Community-and-Workforce-Education_REQ-00001040-1) | 35 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 listing pages, 35/35 raw records; 0 source records lack title/URL |
| 150136 | [Ball State University](https://bsu.wd12.myworkdayjobs.com/External) | 59 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 listing pages, 59/59 raw records; 0 source records lack title/URL |
| 150987 | [Ivy Tech Community College](https://ivytech.wd1.myworkdayjobs.com/Ivy_Tech_Careers/job/Bloomington-IN/Adjunct---Business-Administration_JR0000106908/apply) | 519 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 26 listing pages, 519/519 raw records; 0 source records lack title/URL |
| 153214 | [Des Moines Area Community College](https://jobs.dmacc.edu/postings/search) | 90 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 pages; final page has no next-page link |
| 153630 | [Iowa Western Community College](https://www.schooljobs.com/careers/iwcc) | 41 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 requests; 41/41 unique advertised postings |
| 155061 | [Fort Hays State University](https://fhsu.wd503.myworkdayjobs.com/CAREERS) | 26 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 listing pages, 26/26 raw records; 0 source records lack title/URL |
| 157085 | [University of Kentucky](https://ukjobs.uky.edu/postings/search) | 804 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 27 pages; final page has no next-page link |
| 157289 | [University of Louisville](https://uofl.wd1.myworkdayjobs.com/UofLCareerSite?jobFamilyGroup=122eabeb58371000c79b8793f92f0000) | 135 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 7 listing pages, 135/135 raw records; 0 source records lack title/URL |
| 157447 | [Northern Kentucky University](https://nku.wd108.myworkdayjobs.com/en-US/NKU_External/job/Part-time-faculty_JR100071) | 91 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 listing pages, 91/91 raw records; 0 source records lack title/URL |
| 159391 | [Louisiana State University and Agricultural & Mechanical College](https://lsu.wd1.myworkdayjobs.com/en-US/LSU/job/Part-time-Adjunct-Instructor--Biology_R00106821) | 314 | LSU public employer board; campus/unit assignment requires posting review | 16 listing pages, 314/314 raw records; 0 source records lack title/URL |
| 159416 | [Louisiana State University-Shreveport](https://www.governmentjobs.com/careers/louisiana?department=LSU-Shreveport) | 3 | LSU-Shreveport department on Louisiana state board | 2 requests; 3/3 unique advertised postings |
| 161457 | [University of New England](https://une.peopleadmin.com/postings/search) | 74 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 pages; final page has no next-page link |
| 163657 | [Prince George's Community College](https://pgcc.peopleadmin.com/postings/search) | 170 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 pages; final page has no next-page link |
| 166027 | [Harvard University](https://academicpositions.harvard.edu/postings/search) | 231 | Harvard academic positions | 8 pages; final page has no next-page link |
| 170790 | [Macomb Community College](https://www.schooljobs.com/careers/macombcc) | 33 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 requests; 33/33 unique advertised postings |
| 172617 | [Washtenaw Community College](https://jobs.wccnet.edu/postings/search) | 96 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 pages; final page has no next-page link |
| 174428 | [Normandale Community College](https://minnstate.wd115.myworkdayjobs.com/en-US/Minnesota_State_Careers) | 3 | Normandale Institution facet on Minnesota State board | 1 listing pages, 3/3 raw records; 0 source records lack title/URL |
| 175014 | [Rasmussen University-Minnesota](https://recruiting.ultipro.com/AME1070/JobBoard/cbf863ee-da68-4d60-9da0-e17b3404411c/?q=&o=postedDateDesc) | 76 | Rasmussen employer board across campuses; not Minnesota-only | 2 API pages; 76/76 opportunities |
| 178721 | [Park University](https://park.wd1.myworkdayjobs.com/ParkUniversityCareers?timeType=1851260486fd100728d3e4fb5bf60000) | 10 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 listing pages, 10/10 raw records; 0 source records lack title/URL |
| 179308 | [Saint Louis Community College](https://www.schooljobs.com/careers/stlcc) | 120 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 26 requests; 120/120 unique advertised postings |
| 180814 | [Bellevue University](https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=191fb38a-3b70-4f49-b37f-cb2eda186474&ccId=9201943375161_2&lang=en_US) | 4 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 API pages; 4/4 requisitions |
| 181303 | [Metropolitan Community College Area](https://mccneb.wd5.myworkdayjobs.com/en-US/mccnebjobs/job/English-Adjunct-Instructor_JR100368) | 67 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 listing pages, 67/67 raw records; 0 source records lack title/URL |
| 182005 | [College of Southern Nevada](https://nshe.wd1.myworkdayjobs.com/en-US/CSN-External/job/CSN---Charleston-Campus/Adjunct-Mathematics-Instructor---FY-2021-2022_R0125823) | 169 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 9 listing pages, 169/169 raw records; 0 source records lack title/URL |
| 183026 | [Southern New Hampshire University](https://snhu.wd503.myworkdayjobs.com/External_Career_Site/job/On-Site-New-Hampshire/On-Campus-Adjunct-Instructor---Engineering_R0014807/apply) | 60 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 listing pages, 60/60 raw records; 0 source records lack title/URL |
| 183877 | [Rowan College at Burlington County](https://www.schooljobs.com/careers/rcbcedu) | 27 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 requests; 27/27 unique advertised postings |
| 186380 | [Rutgers University-New Brunswick](https://jobs.rutgers.edu/postings/search) | 960 | Rutgers university-wide board; not New Brunswick-only | 32 pages; final page has no next-page link |
| 187046 | [Thomas Edison State University](https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=089b582f-0a35-44db-98f2-170a98083ab9&ccId=19000101_000001&lang=en_US) | 11 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 API pages; 11/11 requisitions |
| 187532 | [Central New Mexico Community College](https://chess.wd1.myworkdayjobs.com/CNMJOBS) | 73 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 listing pages, 73/73 raw records; 0 source records lack title/URL |
| 187648 | [Eastern New Mexico University-Main Campus](https://www.schooljobs.com/careers/enmu) | 37 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 requests; 37/37 unique advertised postings |
| 190521 | [CUNY Borough of Manhattan Community College](https://www.bmcc.cuny.edu/job-opportunities/) | 21 | BMCC official single-page vacancies, including linked PDF/Word postings | Official single-page vacancy list, 21 linked vacancies including PDF/Word documents |
| 198154 | [Cape Fear Community College](https://www.schooljobs.com/careers/cfcc) | 145 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 16 requests; 145/145 unique advertised postings |
| 198260 | [Central Piedmont Community College](https://www.schooljobs.com/careers/cpcc) | 47 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 requests; 47/47 unique advertised postings |
| 198455 | [Durham Technical Community College](https://www.schooljobs.com/careers/durhamtech) | 50 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 requests; 50/50 unique advertised postings |
| 198464 | [East Carolina University](https://ecu.peopleadmin.com/postings/search) | 255 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 9 pages; final page has no next-page link |
| 198534 | [Fayetteville Technical Community College](https://faytechcc.peopleadmin.com/postings/search) | 232 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 8 pages; final page has no next-page link |
| 198552 | [Forsyth Technical Community College](https://careers.forsythtech.edu/postings/search) | 70 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 pages; final page has no next-page link |
| 198622 | [Guilford Technical Community College](https://gtcc.peopleadmin.com/postings/search) | 160 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 pages; final page has no next-page link |
| 199148 | [University of North Carolina at Greensboro](https://spartantalent.uncg.edu/postings/search) | 114 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 pages; final page has no next-page link |
| 199218 | [University of North Carolina Wilmington](https://jobs.uncw.edu/postings/search) | 78 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 pages; final page has no next-page link |
| 199281 | [University of North Carolina at Pembroke](https://jobs.uncp.edu/postings/search) | 62 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 pages; final page has no next-page link |
| 199333 | [Pitt Community College](https://www.schooljobs.com/careers/pittccedu) | 33 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 requests; 33/33 unique advertised postings |
| 199856 | [Wake Technical Community College](https://www.schooljobs.com/careers/waketechedu) | 33 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 requests; 33/33 unique advertised postings |
| 201885 | [University of Cincinnati-Main Campus](https://jobs.uc.edu/) | 327 | University of Cincinnati Main Campus facet | 33 API pages; 327/327 distinct IDs |
| 201946 | [University of Cincinnati-Clermont College](https://jobs.uc.edu/) | 13 | University of Cincinnati Clermont College facet | 2 API pages; 13/13 distinct IDs |
| 201955 | [University of Cincinnati-Blue Ash College](https://jobs.uc.edu/) | 14 | University of Cincinnati Blue Ash Campus facet | 2 API pages; 14/14 distinct IDs |
| 202222 | [Columbus State Community College](https://cscc.wd1.myworkdayjobs.com/en-US/CSCC_ext/job/Adjunct---COLS-1100_JR001547) | 116 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 listing pages, 116/116 raw records; 0 source records lack title/URL |
| 202806 | [Franklin University](https://recruiting.ultipro.com/FRA1012FRANK/JobBoard/e51857cc-39da-44b8-a30e-839c982ff791/?q=&o=postedDateDesc) | 18 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 API pages; 18/18 opportunities |
| 204857 | [Ohio University-Main Campus](https://www.ohiouniversityjobs.com/postings/search) | 131 | Ohio University employer board; regional campuses may be included | 5 pages; final page has no next-page link |
| 205470 | [Sinclair Community College](https://jobs.sinclair.edu/postings/search) | 106 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 pages; final page has no next-page link |
| 207449 | [Oklahoma City Community College](https://www.occcjobs.com/postings/search) | 147 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 pages; final page has no next-page link |
| 207847 | [Southeastern Oklahoma State University](https://seok.csod.com/ux/ats/careersite/1/home?c=seok) | 20 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 API pages; 20/20 requisitions |
| 207935 | [Tulsa Community College](https://www.schooljobs.com/careers/tulsacc) | 79 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 9 requests; 79/79 unique advertised postings |
| 209542 | [Oregon State University](https://jobs.oregonstate.edu/postings/search) | 59 | Oregon State employer board across locations | 2 pages; final page has no next-page link |
| 209746 | [Portland Community College](https://portlandcc.wd12.myworkdayjobs.com/External) | 114 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 listing pages, 114/114 raw records; 0 source records lack title/URL |
| 212133 | [Eastern University](https://www.schooljobs.com/careers/easternpa) | 66 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 8 requests; 66/66 unique advertised postings |
| 214111 | [Montgomery County Community College](https://www.schooljobs.com/careers/mc3) | 74 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 9 requests; 74/74 unique advertised postings |
| 218113 | [Greenville Technical College](https://gvltec.csod.com/ux/ats/careersite/1/home?c=gvltec) | 30 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 API pages; 30/30 requisitions |
| 218894 | [Trident Technical College](https://www.governmentjobs.com/careers/sc/tridenttech) | 38 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 requests; 38/38 unique advertised postings |
| 219471 | [University of South Dakota](https://yourfuture.sdbor.edu/postings/search?query_organizational_tier_1_id%5B%5D=1259) | 46 | University of South Dakota organizational tier 1 = 1259 | 2 pages; final page has no next-page link |
| 220862 | [University of Memphis](https://ibqajb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs) | 165 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 API pages; 165/165 jobs |
| 222992 | [Austin Community College District](https://austincc.wd1.myworkdayjobs.com/en-US/External?timeType=2f34dcec13810172ce244b0c661f6000&jobFamilyGroup=38af3f28ce3701e5f984329054033c61) | 88 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 listing pages, 88/88 raw records; 0 source records lack title/URL |
| 223427 | [Blinn College District](https://blinn.csod.com/ux/ats/careersite/1/home?c=blinn) | 61 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 API pages; 61/61 requisitions |
| 223816 | [Central Texas College](https://www.schooljobs.com/careers/ctcd) | 49 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 requests; 49/49 unique advertised postings |
| 224110 | [North Central Texas College](https://employment.nctc.edu/postings/search) | 96 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 pages; final page has no next-page link |
| 224554 | [East Texas A&M University](https://tamus.wd1.myworkdayjobs.com/en-US/ETAMU_External/job/Adjunct-Faculty---CID-Human-Resources_R-073825) | 85 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 5 listing pages, 85/85 raw records; 0 source records lack title/URL |
| 224615 | [Dallas College](https://dallascollege.wd1.myworkdayjobs.com/en-US/Dallas_College_Careers/job/Adjunct-Faculty--CEF-Instructors-AY-26-27_R14008) | 47 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 listing pages, 47/47 raw records; 0 source records lack title/URL |
| 224642 | [El Paso Community College](https://www.schooljobs.com/careers/epcc) | 160 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 17 requests; 160/160 unique advertised postings |
| 226091 | [Lamar University](https://www.schooljobs.com/careers/lamar) | 63 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 8 requests; 63/63 unique advertised postings |
| 226578 | [McLennan Community College](https://www.schooljobs.com/careers/mclennan) | 43 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 requests; 43/43 unique advertised postings |
| 227304 | [Odessa College](https://jobs.odessa.edu/postings/search) | 209 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 7 pages; final page has no next-page link |
| 227368 | [The University of Texas Rio Grande Valley](https://careers.utrgv.edu/postings/search) | 167 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 pages; final page has no next-page link |
| 227881 | [Sam Houston State University](https://shsu.peopleadmin.com/postings/search) | 396 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 14 pages; final page has no next-page link |
| 228723 | [Texas A&M University-College Station](https://tamus.wd1.myworkdayjobs.com/TAMU_External) | 113 | Texas A&M University external board; excludes other TAMU system agencies | 6 listing pages, 113/113 raw records; 0 source records lack title/URL |
| 230418 | [Ensign College](https://wd501.myworkdaysite.com/recruiting/ensigncollege/EnsignCollege) | 14 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 listing pages, 14/14 raw records; 0 source records lack title/URL |
| 230603 | [Southern Utah University](https://www.schooljobs.com/careers/suu) | 28 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 requests; 28/28 unique advertised postings |
| 230737 | [Utah Valley University](https://www.schooljobs.com/careers/uvu) | 73 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 9 requests; 73/73 unique advertised postings |
| 230746 | [Salt Lake Community College](https://www.schooljobs.com/careers/slcc) | 132 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 15 requests; 132/132 unique advertised postings |
| 230782 | [Weber State University](https://jobs.weber.edu/postings/search) | 162 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 6 pages; final page has no next-page link |
| 230861 | [Community College of Vermont](https://vsc.wd108.myworkdayjobs.com/en-US/CCV/job/Part-time-Faculty-in-Arts--Communication--and-Humanities_R-2026103-1) | 16 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 listing pages, 16/16 raw records; 0 source records lack title/URL |
| 232557 | [Liberty University](https://liberty.wd5.myworkdayjobs.com/en-US/lu_job_board_faculty/job/Residential-Adjunct-Faculty-Marketing---School-of-Business_R0004448) | 56 | Liberty faculty board | 3 listing pages, 56/56 raw records; 0 source records lack title/URL |
| 232946 | [Northern Virginia Community College](https://jobs.vccs.edu/postings/search?query_organizational_tier_1_id%5B%5D=7897) | 51 | Northern Virginia organizational tier 1 = 7897 | 2 pages; final page has no next-page link |
| 232982 | [Old Dominion University](https://jobs.odu.edu/postings/search) | 75 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 pages; final page has no next-page link |
| 233772 | [Tidewater Community College](https://jobs.vccs.edu/postings/search?query_organizational_tier_1_id%5B%5D=7886) | 37 | Tidewater organizational tier 1 = 7886 | 2 pages; final page has no next-page link |
| 236939 | [Washington State University](https://wsu.wd5.myworkdayjobs.com/en-US/WSU_Jobs/job/Adjunct-Faculty---College-of-Nursing--WSU-Tri-Cities--Richland--WA-_R-14709) | 68 | Washington State university-wide board; not Pullman-only | 4 listing pages, 68/68 raw records; 0 source records lack title/URL |
| 239248 | [Milwaukee Area Technical College](https://www.schooljobs.com/careers/matc) | 66 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 8 requests; 66/66 unique advertised postings |
| 240392 | [Herzing University-Madison](https://recruiting2.ultipro.com/HER1009HRZ/JobBoard/267d2e37-abff-4559-8a18-a754503d3749/OpportunityDetail?opportunityId=324e0eba-5103-4680-ae3e-aaa991163ccf&postingId=457133ab-22a4-4cf1-8294-c8edb0403891) | 68 | Herzing employer board across campuses; not Madison-only | 2 API pages; 68/68 opportunities |
| 243780 | [Purdue University-Main Campus](https://careers.purdue.edu/) | 452 | Purdue shared careers board; includes Fort Wayne, Northwest and Global brands | 46 API pages; 452/452 distinct IDs |
| 244437 | [Georgia State University-Perimeter College](https://facultycareers.gsu.edu/postings/search) | 99 | Georgia State faculty board; Perimeter and other GSU units included | 4 pages; final page has no next-page link |
| 247834 | [Collin County Community College District](https://collin.wd1.myworkdayjobs.com/en-US/ExternalFacultyCareerSite/job/Adjunct-Professor--Economics--Applicant-Pool-2026-2027-_R-8005) | 47 | Collin external faculty board | 3 listing pages, 47/47 raw records; 0 source records lack title/URL |
| 248934 | [ECPI University](https://recruiting.ultipro.com/ECP1000ECPI/JobBoard/e017f5e5-4f5e-4a98-a5d2-83db591e186f) | 191 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 4 API pages; 191/191 opportunities |
| 262086 | [University of Massachusetts Global](https://umassglobal.wd5.myworkdayjobs.com/en-US/UMassGlobalCareers/job/Adjunct-Faculty---California-Multiple-Subject-Credential-MAT-Programs--Remote-_R-2098) | 2 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 listing pages, 2/2 raw records; 0 source records lack title/URL |
| 399212 | [Santiago Canyon College](https://www.schooljobs.com/careers/rsccd) | 2 | Rancho Santiago district classified/management board; current jobs are district/Santa Ana, not Santiago-specific | 2 requests; 2/2 unique advertised postings |
| 409315 | [South Texas College](https://southtexascollege.wd12.myworkdayjobs.com/en-US/STC/job/Adjunct-Faculty-Pool--Division-of-Liberal-Arts---2026---2027-_JR101173) | 58 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 listing pages, 58/58 raw records; 0 source records lack title/URL |
| 413413 | [Capella University](https://strayer.wd1.myworkdayjobs.com/CU_Careers) | 12 | Capella public employer board; some roles serve both Capella and Strayer | 1 listing pages, 12/12 raw records; 0 source records lack title/URL |
| 426314 | [Embry-Riddle Aeronautical University-Worldwide](https://embryriddle.wd1.myworkdayjobs.com/AdjunctFacultyOpportunities) | 36 | Embry-Riddle adjunct board across campuses; not Worldwide-only | 2 listing pages, 36/36 raw records; 0 source records lack title/URL |
| 434672 | [Community College of Baltimore County](https://www.schooljobs.com/careers/ccbcmd) | 164 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 18 requests; 164/164 unique advertised postings |
| 444130 | [Northcentral University](https://nus.wd1.myworkdayjobs.com/en-US/Careers) | 55 | National University successor board after Northcentral merger; same inventory as National University, not a separate employer | 3 listing pages, 55/55 raw records; 0 source records lack title/URL |
| 449339 | [American Public University System](https://recruiting.ultipro.com/AME1070/JobBoard/711bd40f-864c-42db-8c62-3c62f2edc13f?o=postedDateDesc) | 3 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 API pages; 3/3 opportunities |
| 449889 | [American College of Education](https://ats.rippling.com/ace/jobs/8750e45f-a397-460b-ad3a-a1f5d6569500) | 8 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 1 API pages; 8/8 items |
| 458919 | [Strayer University-Georgia](https://strayer.wd1.myworkdayjobs.com/en-US/CAREERS/job/Adjunct-Faculty--Accounting--Atlanta--Hybrid-_R30978-1) | 8 | Strayer employer board across locations; not Georgia-only; some shared Capella roles | 1 listing pages, 8/8 raw records; 0 source records lack title/URL |
| 459994 | [Strayer University-Global Region](https://strayer.wd1.myworkdayjobs.com/careers/) | 8 | Strayer employer board across locations; same inventory as Georgia entry | 1 listing pages, 8/8 raw records; 0 source records lack title/URL |
| 476975 | [Colorado State University Global](https://job-boards.greenhouse.io/csuglobalfaculty/jobs/4438362009) | 1 | CSU Global faculty board | Complete board API; 1/1 postings |
| 479956 | [Pennsylvania State University-World Campus](https://psu.wd1.myworkdayjobs.com/en-US/PSU_Academic/job/Part-Time---English-Composition---Adjunct-Instructors_REQ_0000054095-1) | 421 | Penn State academic board across campuses; not World Campus-only | 22 listing pages, 421/421 raw records; 0 source records lack title/URL |
| 480091 | [Bryant & Stratton College-Online](https://recruiting.ultipro.com/BRY1002BSC/JobBoard/6b838b9a-cd2b-436a-903b-0de7b6e17b4f/?q=&o=postedDateDesc) | 185 | Bryant & Stratton employer board across campuses; not Online-only | 4 API pages; 185/185 opportunities |
| 484613 | [University of Phoenix-Arizona](https://uop.avature.net/careers/SearchJobs) | 20 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 3 pages; final short page, 20 postings |
| 489201 | [Clovis Community College](https://www.schooljobs.com/careers/scccd) | 18 | State Center district board; Clovis, Fresno, Reedley, Madera and district jobs included | 3 requests; 18/18 unique advertised postings |
| 489779 | [Purdue University Global](https://careers.purdue.edu/PurdueUniversityGlobal) | 26 | PurdueUniversityGlobal brand; excludes other Purdue brands | 3 API pages; 26/26 distinct IDs |
| 498571 | [Pennsylvania Western University](https://pennwest.peopleadmin.com/postings/search) | 49 | Employer public board; complete inventory of this configured site, not every separate recruiting site | 2 pages; final page has no next-page link |
