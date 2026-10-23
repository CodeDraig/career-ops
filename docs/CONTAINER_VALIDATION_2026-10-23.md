# Container integration validation — 2026-10-23

The fully containerised image now includes `mcp-server-linkedin` **4.28.0** in an
isolated Python **3.13.9** environment. Startup registers the local stdio command
with Codex, preserving any existing `linkedin` registration. Authentication is
completed in the container's noVNC desktop and kept in the existing home volume.
No host credentials are copied into the image and no LinkedIn data request runs
at startup. LinkedIn remains available in interactive sessions only.

## Full 346-school Docker run

All **346 distinct schools were visited again inside Docker**, using the latest
corrected employer routes through the October 19 audit. This is a fresh search
execution run, not an overlay carrying forward earlier successful fetches.

| Result | Schools |
| --- | ---: |
| Complete non-empty search | 335 |
| Complete, verified empty search | 6 |
| Configured search failed completeness checks | 2 |
| No supported enumerable posting route | 3 |
| Total | 346 |

**Successful coverage: 341/346 = 98.55%.** The previous 343/346 result was dated
October 19; two Georgia routes no longer satisfy their required count checks.
Neither has been counted as a verified empty search.

| UNITID | School | Remaining failure |
| --- | --- | --- |
| 139986 | Southern Crescent Technical College | Georgia search returned no results without its required count. Reproduced in both full runs and an independent retry. |
| 140331 | Chattahoochee Technical College | Same missing-count failure; an empty result is unverified. Reproduced in both full runs and an independent retry. |
| 154493 | Upper Iowa University | Jenzabar uses stateful ASP.NET postbacks; no supported stable per-posting URL resolver. Its public employment page was revisited. |
| 488846 | University of the People | Saved public route offers volunteer recruitment; no supported enumerable paid-vacancy source. |
| 500087 | Doral College | Saved public route embeds an employment application; no supported enumerable vacancy inventory. |

Galen/HCA, Bristol and Empire/InterviewExchange worked through the connected
Chrome extension. Galen returned 206 postings over complete paginated results.
Texas A&M's initial pass returned duplicate posting URLs and failed validation;
an independent retry and the final full run returned a unique complete inventory.
The initial pass also reached Galen and Bristol before extension connection;
those setup failures are retained separately from their connected reruns.

The [per-school ledger](college-container-validation-2026-10-23.json) includes the
exact configured routes, scopes, timestamps, counts, pagination metadata and
receipt hashes. Complete results were checked for titled public URLs, duplicate
URLs, and warnings indicating partial pagination. Native provider receipts
include **2,174 HTTP requests**; browser and extension adapter work is additional.
All 346 result hashes and all 341 complete posting-list hashes were checked.

Employer scopes and ownership evidence from the previous audit were retained.
This run is not a new independent ownership investigation. A shared district
board counts as a working route for each relevant school, not as distinct jobs
for each school. Individual job descriptions, remote-adjunct eligibility, and
application submission were not exhaustively tested.

To reproduce using the published ledger as the inventory:

```sh
./cops node container/validate-colleges.mjs \
  --inventory /opt/career-ops/docs/college-container-validation-2026-10-23.json \
  --output /data/college-validation-new
```

Connect Browser Harness first. Choose a fresh output directory for a fresh run.
The validator never loads or modifies the instance's live `portals.yml` or tracker.

## LinkedIn and persistence

The live container's stdio MCP exposed `search_jobs`, `get_job_details` and
`get_job_apply_url`. After the user signed in through noVNC:

- A one-page remote support-engineer search returned 11 job IDs.
- Job `4478864590` returned an 8,813-character posting description.
- Application-link reads for two selected jobs returned `apply.type: unknown`.
  The tool was callable, but those external destinations were not verified.
- Recreating the container preserved exact hashes of Codex registration,
  portable authentication cookies, source-session state, extension pairing and
  the completed college report. A fresh MCP search then returned 12 job IDs
  without signing in again.

Two actual failures were found and fixed during acceptance:

1. MCP stdio clients can filter `DISPLAY` out of the child environment. The
   launcher now supplies the container's `:99` display when absent; this is
   covered by a regression and a real MCP read with that filtered environment.
2. Replacing the container while an MCP browser is open can leave Chrome's
   singleton links naming the previous container. Startup now owns both browser
   profiles exclusively, archives only those transient links, and preserves the
   authentication databases. Both profiles are guarded for the container's
   lifetime, including across independent PID namespaces.

After this recovery fix, a real MCP search returned 11 job IDs using the persisted
source-session generation, with no further login. The portable cookie snapshot
was refreshed during that read; Codex configuration, source-session metadata,
extension pairing and the college report remained byte-identical. A fresh-home smoke test also passed:
it registered the server and reported that login was required. The college
provider, browser adapter and validation-runner source fingerprints are identical
between the full-run image and the image containing this startup-only fix.

## Checks and preservation

- `node test-all.mjs`: **12,891 passed, 0 failed, 16 warnings**. The initial run
  caught a missing `--help` path in the new validation CLI; that was fixed and
  the complete suite rerun. Warnings retain the expected empty-data CV/name
  checks and two opt-in H1B checks that were not enabled.
- Five LinkedIn setup tests and five startup/profile tests pass.
- `node scripts/check-syntax.mjs`: **1,187 scripts passed**.
- Production web build and Go dashboard build passed in Docker. The separate
  web and Go test suites were not rerun; no web or dashboard source changed.
- Source database SHA-256 before and after:
  `913b31191a624b65fe72c8fb858ffaffc9719aa1125f66062315bd89afe4276e`.
- No existing CV, profile, tracker, report, live portal configuration or source
  database was modified. Authentication was created only in the dedicated test
  container's persistent home volume. No application or message was submitted,
  and no paid model call was made.

Raw receipts, both full-run logs, MCP read results, image build logs and
persistence checks are retained in
`/home/cadwaladyr/Downloads/career-ops-container-linkedin-colleges-2026-10-23/`.
Authentication cookie contents are not included in this report or the ledger.
