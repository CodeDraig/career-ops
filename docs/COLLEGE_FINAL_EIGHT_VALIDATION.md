# Final eight college search routes

Revalidated **2026-10-19** (US Eastern; verification continued into October 20 UTC).

**Five more working school routes: 343/346 = 99.1% coverage (99.13% to two decimals).** The combined inventory comprises **337 non-empty routes, 6 verified empty routes, and 3 unresolved schools**. This adds five schools and 1.45 percentage points to the previous 338/346 result. All eight previous failures were revisited; the earlier 338 successes retain their dated evidence and were not all fetched again.

A success still means a complete configured public employer search, including an explicitly named shared board or category. It does not mean every vacancy for that institution is covered or that the results match remote-adjunct criteria. Shared boards must not be summed as unique vacancies.

## Recovered routes

| UNITID | School | Verified inventory | Route and scope |
| --- | --- | ---: | --- |
| 113980 | El Camino Community College District | 12, two pages | iGreentree academic and part-time instructor board. Classified staff is outside this route. All 12 stable requisition referral URLs opened the matching title in separate fresh browser contexts. |
| 156471 | Galen College of Nursing-Louisville | 202, nine pages | Shared Galen board across all campuses, not Louisville-only. Every consecutive page range reconciled to the total through the Chrome extension. |
| 165033 | Bristol Community College | 70, one page | Public all-category InterviewExchange board. All 70 Position IDs matched titled posting links; no pagination. |
| 196264 | Empire State University | 19, one page | Current public all-category InterviewExchange board, separate from the adjunct expression-of-interest repository. All 19 Position IDs matched titled posting links; no pagination. |
| 443650 | Miller-Motte College-Chattanooga | 184, ten API responses | Shared Ancora Education ADP board, including Miller-Motte Chattanooga and other brands/campuses. Chattanooga postings were present. |

Employer ownership is supported by Bristol's [HR referral](https://bristolcc.edu/bristolcommunity/facultystaff/humanresources/index.html), Empire State's [current employment page](https://www.sunyempire.edu/employment_opportunities.html), Miller-Motte's [description of Ancora Education](https://www.miller-motte.edu/blog/skilled-trades/miller-motte-colleges-raleigh-north-carolina-campus-to-add-cdl-class-a-training/), and Ancora's [current careers page and ADP link](https://www.ancora.com/about-us/careers/). The El Camino academic origin and Galen employer search path preserve the institution scopes. Published examples omit transient session identifiers from referrals.

## What changed

- Added an iGreentree recipe to `browser-job-search.mjs`: selects **View All Jobs**, follows form-driven result pages, reconciles the advertised count, and converts visible requisition numbers to the site's working `CSSPage_Referred.ASP?Req=...` URLs. Session-specific job-detail POST URLs are not emitted.
- Added `extension-job-search.mjs` and `lib/browser-harness/college.py` for Galen/HCA and the Bristol/Empire InterviewExchange layout. They use Browser Harness's connected extension with **new_tab, switch_tab, read_page, current_tab, and close_tab only**. No JavaScript evaluation, debugger, CDP, screenshot, or input operation is used. Missing/challenged pages, duplicate postings, incomplete totals, changed totals, foreign-employer pages, and page limits fail without returning partial success.
- Extension searches use the existing Indeed selected-tab lock. They queue for up to four minutes and run for at most five minutes, within the example parser's ten-minute timeout. This allows the scanner's parallel tasks to serialize their extension access. They close only tabs they created; they do not restore a user's previously selected tab.
- Reused the existing ADP Workforce Now provider for Ancora; no provider change was required.
- Added the root adapter to the system-update manifest, regression tests, and a [five-entry example](../templates/college-final-eight-portals.example.yml). The example is not loaded automatically; no live `portals.yml` was changed.

Bristol and Empire remained blocked in isolated Chromium but worked through the connected Chrome extension. Galen's extension access also worked on this pass, unlike the earlier hard-blocked attempt. This is dated access evidence, not a claim that these sites will never challenge future requests. No challenge was bypassed.

## Still unresolved

| UNITID | School | Current evidence and next sharp edge |
| --- | --- | --- |
| 154493 | Upper Iowa University | The Jenzabar employment portal is accessible now. Submitting the empty public search returned eight positions, and the School Counselor Adjunct Instructor MSC detail opened. Links are ASP.NET postbacks and the URL remains the general search page. No stable per-posting URL was verified; emitting eight copies of one URL would break scanner deduplication. Next: verify a supported public deep-link contract or explicitly design a stateful posting resolver. |
| 488846 | University of the People | The saved official route still offers volunteer instructor/general volunteer application forms. No enumerable paid-vacancy source was verified. Volunteer recruitment is not counted as paid-job search coverage. |
| 500087 | Doral College | Join Our Team embeds a Formstack employment application with contact, qualifications, attachments and signature fields. The iframe was inspected; no enumerable vacancy inventory or per-posting URLs were exposed. An application form is not evidence of an empty job board. |

## Reproduction and evidence

Configure the existing Browser Harness Chrome extension as described in [Indeed setup](INDEED.md). The tested installation used:

```sh
export BH_CONFIG_DIR=/srv/data/code/browser-harness/.browser-harness-dev/extensions/user-config
node extension-job-search.mjs --kind hca --company 'Galen College of Nursing (all campuses)' --url https://careers.hcahealthcare.com/search/galen-college-of-nursing/jobs
node extension-job-search.mjs --kind interviewexchange --company 'Bristol Community College' --url https://bristolcc.interviewexchange.com/static/clients/460BCM1/index.jsp
node browser-job-search.mjs --kind igreentree --company 'El Camino College academic board' --url https://elcamino.igreentree.com/CSS_Academic/
```

The [eight-school ledger](college-final-eight-validation-2026-10-19.json) overlays only the failures in the previous ledger, preserving the historical 115-school evidence. Its counts and enabled example entries reconcile in `tests/college-final-eight-coverage.test.mjs`. Raw receipts, public snapshots, detail checks and logs are retained at `/home/cadwaladyr/Downloads/college-final-eight-2026-10-19/`; they are not committed because raw captures can contain transient browser/session identifiers. File hashes are recorded in the published ledger.

## Verification

- Focused extension tests pass for scope, counts, duplicate/changed/missing pages, challenge rejection, transport setup and absence of debugger calls.
- Browser integration tests pass, including iGreentree all-jobs selection, form pagination, stable URLs, truncation, repeated results and blocked later pages.
- All 12 El Camino public referral links reproduced their matching posting titles in fresh browser contexts.
- Isolated data-root scanner dry run exercised all five example routes together: **487 postings, 487 deliberately filtered by the test-only title filter, no errors, no writes**. This includes concurrent extension-backed tasks serialized by the shared lock.
- `node scripts/check-syntax.mjs`: **1,182 scripts passed**. Python helper parsed successfully with `ast.parse`. Both coverage reconciliation tests passed.
- `node test-all.mjs`: **12,883 passed, 0 failed, 15 warnings**. Warnings: one expected empty-data CV check, twelve existing name-string flags (including the Rancho Santiago district), and two skipped opt-in H1B checks (`H1B_API_TEST`, quota-consuming `H1B_MINT_TEST`). The new final-eight ledger test was added after full-suite discovery and run separately; focused extension tests were re-run after the last location/queue changes.
- Source SQLite SHA-256 remains `913b31191a624b65fe72c8fb858ffaffc9719aa1125f66062315bd89afe4276e`. No CV, profile, tracker, live portal configuration, or source database was edited.

Initial probes still encountered WAF pages and an obsolete Empire hostname failed DNS. The first iGreentree run caught an ambiguous start-button selector (four category links); it was narrowed to the actual all-jobs button and passed. The first cleanup of inspection tabs found no selected tab; explicit selection allowed all five task-created inspection tabs to close. These failures were not counted as successful searches.

Individual descriptions were not exhaustively checked outside El Camino. Applications, logins and email were not submitted. Web/dashboard builds and unrelated opt-in network tests were not required by these adapter changes.
