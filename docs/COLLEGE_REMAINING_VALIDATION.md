# Remaining 115 college search routes

**Latest coverage:** the [final-eight validation](COLLEGE_FINAL_EIGHT_VALIDATION.md) raises the combined total to **343/346 (99.1%)**, with three unresolved. Counts below preserve this earlier pass.

Validated **2026-10-19**. Every one of the **115 unresolved schools** was investigated through its saved public sources and, where necessary, an isolated browser or a current official employer referral.

**107 newly working routes: 103 non-empty searches and 4 verified empty searches.** Combined with the previously validated 231, coverage is now **338/346 = 97.7%**: **332 non-empty and 6 verified empty routes; 8 unresolved**. This is an increase of 107 schools and 30.9 percentage points. The earlier 231 successes were not all re-fetched in this pass; the combined count retains their dated validation.

## Scope of the count

A success means a complete search on the configured public employer board, category, or explicitly named shared district/system. It does not mean every hiring site for that institution is covered, that every posting belongs to one campus, or that there are remote-adjunct matches. Shared boards must not be summed as unique jobs. The table and example names identify shared or limited categories.

Three current RCCD routes (Riverside, Moreno Valley and Norco) returned an explicit empty board. Their shared empty inventory counts as three school routes, not three independent inventories. UAGC returned an explicit empty page and public API response. Its Jobsyn browser adapter was additionally validated against all 264 postings on CUNY’s populated board across 27 pages; that cross-check adds no extra school to this count. No application forms, volunteer expressions of interest, first-page-only results, or unreadable boards count as successful searches.

## Implementation

- Added native public providers for SilkRoad, UWA's Interfolio WordPress feed, ClearCompany, and AgileHR.
- Added ADP MyJobs anonymous-session searches, with tenant checks and count reconciliation. Its public tenant token stays in memory; it is not printed, saved, or taken from a logged-in user.
- Added a PeopleSoft browser fallback for Lone Star's browser bootstrap and adjunct family filter. It reuses the existing parser and public detail URL builder; all 388 adjunct rows were traversed across eight responses.
- Added browser recipes for Jobsyn, Paycom, Paylocity, Paycor iframes, Dayforce, BrassRing, NEOED, ExactHire, LCTCS, AGMU, Eastern Florida, Kingsborough, CUNY SPS, Baton Rouge, and Central Georgia's posting PDFs.
- Fixed cumulative/button pagination, delayed result-count readiness, iframe extraction, and closed-row exclusion. Repeated pages, missing totals, broken later pages, and page caps fail without emitting partial success.
- Recognized legacy Cornerstone site URLs, preserved NEOGOV location facets using `facetlocation`, and accepted a fully enumerated PeopleSoft grid containing duplicate opening IDs. North Georgia returned 263 grid rows containing 261 distinct jobs.
- Replaced obsolete or misleading routes: Alabama's old empty faculty site with its 199-posting current search; Shasta's two-record SchoolJobs mirror with the complete 46-posting NEOED search; UT San Antonio's health-staff candidate with its own 53-posting academic PeopleSoft site.
- Community College of Philadelphia's [current official referral](https://www.ccp.edu/about-ccp/news-events/career-opportunities) points to [SchoolJobs](https://www.schooljobs.com/careers/ccp), which returned 47 postings. The saved PeopleAdmin hostname has a certificate mismatch. The official referral was read using the web tool after the local browser encountered Cloudflare.

No dependency, live portal configuration, profile, CV, tracker, or source database was changed. Browser routes use isolated Playwright Chromium, not a user Chrome debugger or the Browser Harness extension. Galen was re-tested this way; its previously tested extension path was not re-run in this pass.

## Run the routes

The [107-entry example](../templates/college-remaining-portals.example.yml) is not loaded automatically. Merge desired entries into your data root's `portals.yml` under `tracked_companies`, preserving your filters. Keep explicit site IDs, campus filters, and category scopes. Browser adapters run through the existing `local-parser` provider and require installed Playwright Chromium. They emit JSON on stdout and fail on stderr with a nonzero exit.

```sh
node browser-job-search.mjs --kind neoed --company 'Shasta College' --url 'https://shastacc.attract.neoed.com/'
node peoplesoft-browser-search.mjs --company 'Lone Star College System' --url 'https://hcm.lonestar.edu/hcmjob.jsp' --family Adjunct
```

The [machine-readable ledger](college-remaining-validation-2026-10-19.json) contains all 115 UNITIDs, inspected URLs, result hashes, route scopes, pagination evidence and enabled example entries. Raw responses, reproduction scripts and full inventories are retained locally at `/home/cadwaladyr/Downloads/college-remaining-validation-2026-10-19/`. Raw browser captures may contain anonymous session/telemetry identifiers and are not published in the repository. The source SQLite SHA-256 is recorded in the ledger and checked again at completion.

## Remaining unresolved schools

| UNITID | School | Observed limitation |
| --- | --- | --- |
| 113980 | El Camino Community College District | iGreentree search and job-detail POSTs load, but no working stable public posting URL was verified. GET with the observed ReqKey did not reproduce the detail. |
| 154493 | Upper Iowa University | myUIU employment portal serves Cloudflare to the isolated browser; its public search could not be executed. |
| 156471 | Galen College of Nursing-Louisville | HCA returns first-page postings but Cloudflare blocks page two; partial output is rejected. |
| 165033 | Bristol Community College | InterviewExchange route did not expose recognized posting titles through the isolated browser; WAF/unrecognized listing. |
| 196264 | Empire State University | Saved adjunct route is a CV submission repository/form, not a vacancy search. Official legacy HR referral could not be loaded. |
| 443650 | Miller-Motte College-Chattanooga | Saved pages concern student career training. Official Miller-Motte hiring event points to ancora.com/careers, but both apex and www career routes failed to fetch. |
| 488846 | University of the People | Saved route recruits volunteer instructors via an application form, not a searchable paid-vacancy inventory. |
| 500087 | Doral College | Join Our Team embeds a Formstack expression-of-interest form; no enumerable vacancy listing was exposed. |

The next work is specifically bounded: stable iGreentree detail links, access to the challenged myUIU/InterviewExchange/HCA pages, and a current usable vacancy source for the form-only or unavailable routes. An inaccessible source is not treated as evidence that no jobs exist.

## Per-school results

| UNITID | School | Provider | Postings | Scope / result |
| --- | --- | --- | ---: | --- |
| 100751 | The University of Alabama | browser:clinch | 199 | Institution public employer board |
| 101514 | John C Calhoun State Community College | neogov | 5 | Calhoun full-time public board; separate part-time listings outside this route |
| 101587 | University of West Alabama | interfolio-wordpress | 40 | Institution public employer board |
| 104151 | Arizona State University Campus Immersion | workday | 147 | Shared ASU staff board; includes campus and digital operations; not faculty |
| 104179 | University of Arizona | csod | 393 | Institution public employer board |
| 104708 | Glendale Community College | peoplesoft | 300 | Shared Maricopa district board; includes other member colleges |
| 105154 | Mesa Community College | peoplesoft | 300 | Shared Maricopa district board; includes other member colleges |
| 105428 | Phoenix College | peoplesoft | 300 | Shared Maricopa district board; includes other member colleges |
| 108667 | College of Alameda | neogov | 56 | Shared Peralta district board; Alameda, Berkeley, Laney and Merritt |
| 109208 | American River College | neogov | 104 | Shared Los Rios district board, all member colleges |
| 111887 | Cerritos College | neogov | 17 | Institution public board |
| 113096 | Cosumnes River College | neogov | 64 | Shared Los Rios district faculty board, all member colleges |
| 113218 | Cuyamaca College | workday | 87 | Grossmont-Cuyamaca shared district |
| 113236 | Cypress College | peopleadmin | 48 | Shared North Orange County district board, Cypress and Fullerton |
| 113333 | De Anza College | neogov | 170 | Shared Foothill-De Anza district board |
| 113856 | East Los Angeles College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 113980 | El Camino Community College District | — | — | session-dependent |
| 114789 | Fresno City College | neogov | 18 | Shared State Center district classified board; separate faculty recruitment is outside this route |
| 114859 | Fullerton College | peopleadmin | 48 | Shared North Orange County district board, Cypress and Fullerton |
| 115001 | Glendale Community College | neogov | 100 | Institution public employer board |
| 115296 | Grossmont College | workday | 87 | Grossmont-Cuyamaca shared district |
| 116439 | Irvine Valley College | neogov | 44 | Shared South Orange County district board; Saddleback and Irvine Valley |
| 117052 | Reedley College | neogov | 18 | Shared State Center district classified board; separate faculty recruitment is outside this route |
| 117690 | Los Angeles Harbor College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 117706 | Los Angeles Pierce College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 117715 | Los Angeles Southwest College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 117724 | Los Angeles Trade Technical College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 117733 | Los Angeles Valley College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 117788 | Los Angeles City College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 117867 | Los Angeles Mission College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 118772 | Merritt College | neogov | 56 | Shared Peralta district board; Alameda, Berkeley, Laney and Merritt |
| 121619 | Santa Ana College | neogov | 2 | Shared Rancho Santiago district board; separate recruiting categories are outside this route |
| 121901 | Riverside City College | peopleadmin | 0 | Shared RCCD district board; Riverside, Moreno Valley and Norco |
| 122180 | Sacramento City College | neogov | 64 | Shared Los Rios district faculty board, all member colleges |
| 122375 | San Diego Mesa College | peopleadmin | 2 | San Diego Mesa campus filter 265 within SDCCD |
| 122791 | College of San Mateo | browser:interviewexchange | 47 | Shared San Mateo County district part-time faculty pools |
| 123299 | Shasta College | browser:neoed | 46 | Current Shasta NEOED board; replaces incomplete two-record SchoolJobs mirror |
| 123800 | Southwestern College | neogov | 40 | Institution public employer board |
| 125170 | Berkeley City College | neogov | 56 | Shared Peralta district board; Alameda, Berkeley, Laney and Merritt |
| 125471 | West Los Angeles College | csod | 83 | Shared Los Angeles Community College District academic board, all nine member colleges |
| 125499 | West Valley College | peopleadmin | 73 | West Valley campus filter 573 |
| 126827 | Colorado Technical University-Colorado Springs | browser:adp-myjobs | 48 | Institution public employer board |
| 131113 | Wilmington University | browser:taleoBusiness | 8 | Wilmington adjunct faculty category cws=60 |
| 131469 | George Washington University | peopleadmin | 119 | Institution public employer board |
| 132693 | Eastern Florida State College | browser:easternFlorida | 36 | Institution public employer board |
| 133508 | Florida SouthWestern State College | silkroad | 41 | Institution public employer board |
| 133702 | Florida State College at Jacksonville | peoplesoft | 57 | Institution board |
| 136358 | Palm Beach State College | workday | 270 | Institution public employer board |
| 137078 | St Petersburg College | peoplesoft | 217 | Institution public employer board |
| 138187 | Valencia College | peopleadmin | 28 | Institution public board |
| 139931 | Georgia Southern University | peoplesoft | 217 | Institution public employer board |
| 141264 | Valdosta State University | peoplesoft | 97 | Institution public board |
| 141334 | University of West Georgia | peoplesoft | 143 | Institution public employer board |
| 141811 | Leeward Community College | neogov | 46 | Leeward campus location filters from official employment link |
| 144865 | College of DuPage | csod | 111 | Institution public employer board |
| 145600 | University of Illinois Chicago | csod | 150 | UIC academic/university site 1; separate UI Health site excluded |
| 147536 | National Louis University | icims | 61 | Institution public employer board |
| 154022 | The University of Arizona Global Campus | browser:jobsyn | 0 | Institution public employer board |
| 154493 | Upper Iowa University | — | — | blocked |
| 154697 | Barton County Community College | agilehr | 37 | Institution public employer board |
| 156471 | Galen College of Nursing-Louisville | — | — | blocked |
| 156541 | University of the Cumberlands | workday | 30 | Institution public employer board |
| 158662 | Delgado Community College | browser:lctcs | 31 | Institution public employer board |
| 161572 | Unity Environmental University | browser:paycom | 41 | Institution public employer board |
| 163426 | Montgomery College | workday | 39 | Institution public employer board |
| 164988 | Boston University | silkroad | 195 | Institution public employer board |
| 165033 | Bristol Community College | — | — | blocked |
| 170055 | Grand Rapids Community College | clearcompany | 42 | Institution public employer board |
| 171535 | Oakland Community College | neogov | 95 | Institution public employer board |
| 176372 | University of Southern Mississippi | csod | 142 | Institution public employer board |
| 177065 | Columbia College | browser:paycor | 27 | Institution public employer board |
| 178059 | Maryville University of Saint Louis | browser:adp-myjobs | 34 | Maryville adjunct faculty MyJobs board |
| 181394 | University of Nebraska at Omaha | peopleadmin | 52 | Institution public employer board |
| 182500 | Truckee Meadows Community College | workday | 92 | Institution public employer board |
| 187444 | William Paterson University of New Jersey | workday | 54 | Institution public board |
| 190576 | CUNY Graduate School and University Center | browser:cunySps | 4 | CUNY School of Professional Studies part-time opportunities; Graduate Center administrative family, not main-campus coverage |
| 190619 | CUNY Kingsborough Community College | browser:kingsborough | 19 | Institution public employer board |
| 196264 | Empire State University | — | — | no-listing |
| 196592 | Touro University | icims | 257 | Institution public employer board |
| 202356 | Cuyahoga Community College District | csod | 352 | Institution public employer board |
| 207500 | University of Oklahoma-Norman Campus | browser:clinch | 323 | Institution public employer board |
| 210605 | Community College of Allegheny County | csod | 115 | Institution public employer board |
| 210809 | American College of Financial Services | browser:paycom | 5 | Institution public employer board |
| 215239 | Community College of Philadelphia | neogov | 47 | Institution public employer board |
| 220552 | South College | browser:paylocity | 134 | Institution public employer board |
| 227182 | Lone Star College System | browser:peoplesoft | 388 | Lone Star adjunct job-family filter; other job families excluded |
| 227854 | St Philip's College | csod | 214 | Shared Alamo district faculty board, not St. Philip's only |
| 227924 | San Antonio College | csod | 49 | Alamo San Antonio College faculty site 12 |
| 227979 | San Jacinto Community College | csod | 209 | Institution public employer board |
| 228769 | The University of Texas at Arlington | peopleadmin | 42 | UT Arlington faculty position type 3 |
| 229027 | The University of Texas at San Antonio | peoplesoft | 53 | UT San Antonio academic PeopleSoft site 21; UT Health staff Oracle board excluded |
| 229115 | Texas Tech University | browser:brassring | 53 | Texas Tech faculty BrassRing site 5637; staff, students and TTUHSC excluded |
| 242972 | NUC University | adp-workforcenow | 869 | Shared Northbridge/NUC employer board, multiple campuses and brands; not Puerto Rico campus-only |
| 246354 | Palo Alto College | csod | 26 | Alamo Palo Alto College faculty site 18 |
| 364025 | Chandler-Gilbert Community College | peoplesoft | 300 | Shared Maricopa district board; includes other member colleges |
| 420398 | Northwest Vista College | csod | 20 | Alamo Northwest Vista College faculty site 15 |
| 436429 | Los Angeles Film School | browser:exacthire | 11 | Institution public employer board |
| 437103 | Baton Rouge Community College | browser:brcc | 66 | Institution public employer board |
| 443650 | Miller-Motte College-Chattanooga | — | — | blocked |
| 444219 | Folsom Lake College | neogov | 104 | Shared Los Rios district board, all member colleges |
| 445027 | American InterContinental University System | browser:adp-myjobs | 10 | Institution public employer board |
| 450933 | Columbia Southern University | browser:paycor | 16 | Columbia Southern faculty openings |
| 460394 | Moreno Valley College | peopleadmin | 0 | Shared RCCD district board; Riverside, Moreno Valley and Norco |
| 460464 | Norco College | peopleadmin | 0 | Shared RCCD district board; Riverside, Moreno Valley and Norco |
| 475121 | South University-Savannah Online | browser:dayforce | 40 | Institution public employer board |
| 482477 | DeVry University-Illinois | browser:dayforce | 94 | Institution public employer board |
| 482680 | University of North Georgia | peoplesoft | 261 | Institution public employer board |
| 483045 | Central Georgia Technical College | browser:easyhr | 5 | Central Georgia current part-time/adjunct category 436; five posting PDFs |
| 483124 | Arizona State University Digital Immersion | workday | 147 | Shared ASU staff board; includes campus and digital operations; not faculty |
| 483595 | Ana G. Mendez University | browser:agmu | 32 | Institution public employer board |
| 485111 | Georgia Military College | browser:paycom | 143 | Institution public employer board |
| 486840 | Kennesaw State University | peoplesoft | 240 | Institution public employer board |
| 488846 | University of the People | — | — | no-listing |
| 497046 | Madera Community College | neogov | 18 | Shared State Center district classified board; separate faculty recruitment is outside this route |
| 500087 | Doral College | — | — | no-listing |

## Verification

- `node test-all.mjs`: **12,879 passed, 0 failed, 12 warnings**. Ten warnings concern the expected empty-data CV smoke test and existing “Santiago” string checks; two optional H1B tests were skipped (`H1B_API_TEST`, and quota-consuming `H1B_MINT_TEST`).
- `node tests/providers/college-additional.test.mjs`: six passing regression groups.
- `node tests/browser-job-search.integration.mjs`: passed DOM extraction for every recipe and pagination/failure tests in isolated Chromium; re-run after the final Jobsyn change.
- `node tests/peoplesoft-browser-search.integration.mjs`: passed bootstrap, cumulative results, public URL and cap checks.
- `node tests/college-remaining-coverage.test.mjs`: passed evidence/config reconciliation and disjoint 346-school inventory checks.
- `node scripts/check-syntax.mjs`: **1,179 scripts passed**; final browser script also checked with `node --check`.
- `CAREER_OPS_ROOT=<isolated scanner-smoke directory> node scan.mjs --dry-run`: native SilkRoad plus browser BrassRing returned **94 postings**, all filtered out by the test configuration. The initial attempt got an unrecognized SilkRoad response; the independent provider recheck and scanner retry passed. The isolated data root contains only its supplied `portals.yml`.
- All 115 result receipt hashes and discovery artifacts checked; source SQLite hash unchanged; `git diff --check` passed. No user-layer paths appear in the diff.
- The first full suite failed because ClearCompany lacked an example stanza; the stanza was added and the suite re-run successfully. A one-off YAML generator needed a corrected namespace import before producing the example. Final Jobsyn testing caught and fixed a hidden terminal “More” button by stopping at the reconciled total.
- Web/dashboard builds and unrelated opt-in H1B network/token tests were not run; no web/dashboard code changed. Individual posting descriptions and application submission were not exhaustively tested. No login, application or email was submitted.
