# Workday request pacing and simultaneous Docker validation — 2026-10-23

Three independent Career-Ops instances were retested together after the previous
simultaneous run produced six Workday HTTP 429 failures: LSU in all three,
Ivy Tech in two, and Park in one. The earlier evidence remains at
`/home/cadwaladyr/Downloads/career-ops-three-container-load-2026-10-23/`.

## Change

`providers/_http.mjs` now coordinates Workday provider requests through
`providers/_workday-pacing.mjs`. The three containers mount the same
`career-ops-workday-pacing` volume while retaining separate data and home volumes.
The SQLite budget permits one start per second per host and one every 200 ms
across Workday hosts. It includes page 0, pagination, retries and detail lookups.
Queue waiting happens before each HTTP request's timeout begins.

A 429 publishes its cooldown to other workers. Without `Retry-After`, host
cooldowns rise from 30 to 60 to 120 seconds; other Workday hosts pause for up to
30 seconds as a precaution against an edge-wide block. Waiters recheck state
before starting. A long upstream `Retry-After` is preserved and reported as
deferred rather than shortened and retried early. Retry exhaustion still
reports incomplete pagination. Other providers retain their existing transport.

The shared-egress quota is a working hypothesis based on the overlapping-run
failures; Workday's precise WAF quota scope and threshold have not been established.
Pacing trades scan speed for fewer collisions. Single-user CLI processes share
a local temporary timing database; Docker deployments use the persistent shared
volume. See [Docker setup](../DOCKER.md) for overrides and manual mounts.

## Live Docker results

A targeted simultaneous run returned **506 Ivy Tech, 326 LSU and 9 Park postings
in each container**, with no HTTP request errors. Every targeted posting-list
hash and response receipt was checked.

All **346 schools were then fetched again in each container**, with six native
workers and two browser workers per container. These are fresh runs, not an
overlay or reuse of the targeted results. Employer ownership scopes and routes
come from the existing audited inventory; this is not a new ownership audit.

| Instance | Non-empty | Verified empty | Errors | Unresolved | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Thomas | 336 | 6 | 1 | 3 | 98.84% |
| Courtney | 335 | 6 | 2 | 3 | 98.55% |
| Brandon | 335 | 6 | 2 | 3 | 98.55% |

All **57 Workday school routes completed in each container: 171/171**, with
**zero Workday HTTP errors or rate limits** across 2,274 Workday requests.
In the full runs, each container returned 509 Ivy Tech, 326 LSU and nine Park
postings. Ivy Tech's inventory changed after the earlier 506-posting targeted
run; all three fresh full runs agreed on 509.

One unrelated Jobvite request returned 429 and recovered through its existing
retry policy. Johns Hopkins' Eightfold API returned 403 in each instance and
the existing fallback completed the board. These four HTTP error receipts
remain in the ledger; they are not failed school searches.
Every result hash, successful posting-list hash, and saved HTTP-response hash
was verified: `{"results": 1038, "postingLists": 1024, "responses": 6535}`.

The [per-school ledger](college-workday-pacing-validation-2026-10-23.json)
records all three fresh runs, dates, counts, result hashes, posting-list hashes,
HTTP errors and the verified image. Raw receipts, resource samples, command
logs and reproduction scripts are preserved under `/home/cadwaladyr/Downloads/career-ops-workday-fix-2026-10-23`.

The three unresolved routes remain Upper Iowa (stateful Jenzabar and no stable
per-posting resolver), University of the People (volunteer route), and Doral
College (general application form). None is counted as an empty search.

## Separate browser follow-ups and current coverage

The simultaneous full runs had five browser failures, independent of Workday:
Columbia Southern in Thomas (`document still loading`), Galen in Courtney and
Brandon (repeated posting across pages), and Houston City College in Courtney
and Brandon (pagination did not advance to the requested page).

| Instance | School | Follow-up | Result | Postings |
| --- | --- | --- | --- | ---: |
| Brandon | Galen College of Nursing-Louisville | browser-followup | working | 206 |
| Brandon | Houston City College | browser-followup | error | — |
| Courtney | Galen College of Nursing-Louisville | browser-followup | working | 206 |
| Courtney | Houston City College | browser-followup | working | 285 |
| Thomas | Columbia Southern University | browser-followup | working | 17 |
| Brandon | Houston City College | browser-serial-followup | working | 285 |

Houston in Brandon failed the first follow-up again, then completed when run
alone after the other requests stopped. This is evidence of intermittent
browser pagination, not a browser-parser fix. All first-pass and follow-up
failure receipts are preserved. No completeness assertion was relaxed.

Applying only the separately verified successful follow-ups yields **337
non-empty, six verified empty and three unresolved schools in every instance:
343/346 = 99.13%**. The ledger stores this as a distinct coverage overlay; its
raw simultaneous-run counts above remain unchanged. Browser pagination
stability remains a separate sharp edge.

## Resources and persistence

| Instance | Elapsed | Average CPU | Sampled peak working RAM |
| --- | ---: | ---: | ---: |
| Thomas | 8.83 min | 1.12 cores | 2.38 GiB |
| Courtney | 9.67 min | 1.08 cores | 2.35 GiB |
| Brandon | 9.67 min | 1.03 cores | 2.50 GiB |

Combined sampled peak working RAM was **7.04 GiB**;
combined sampled peak CPU was **11.35 logical cores**.
Samples are about five seconds apart. Kernel memory peaks include cache and
are kept separately in the raw final checks. The root suite overlapped the
early part of live verification, so wall time is not a controlled performance
comparison with the previous run.

All three instances retained their data/home mounts and their extension
connections after recreation, and web `/api/version` and noVNC returned 200.
The pacing database integrity check returned `ok`.
Prior stopped containers and their image remain available for rollback.

Verified image: `sha256:509e891310db6e7f83d148af84758e8e25efad4f54b59d2c5a1840fa27390aba`.

## Checks and limits

- `node test-all.mjs`: **12900 passed, 0 failed, 17 warnings**.
  Warnings were reviewed: absent CV fixture, public proper-name matches in
  existing source/evidence, and the two opt-in H1B API/token checks.
- Focused Workday tests: **216 passed**; shared HTTP tests: **27 passed**.
- The seven new pacing regressions also passed inside the final Docker image
  on Node 24. They cover separate processes, restart timing, shared cooldowns,
  queued waiters, Retry-After, actual POST/GET dispatch, and timeout placement.
- `node scripts/check-syntax.mjs`: **1,189 files passed**.
- `docker compose config --quiet` and the production image build passed.
  The image build includes the production web build and Go dashboard build.
- Separate web and Go unit suites and opt-in H1B network/token checks were not
  rerun; their sources and integrations are unchanged.

An initial comma-separated `--only` filter matched no test files and was
replaced by supported single-substring invocations. Initial new regressions
caught compressed request starts; dispatch timing was fixed before deployment.
An initial `/api/health` probe returned 404; the defined `/api/version` probe
passed. These were verification setup/corrected implementation failures, and
are not counted as successful tests.

No CV, profile, tracker or live portals configuration changed. The validator
reads an explicit system inventory and writes only fresh validation receipts.
Future Workday limits can change; a later 429 remains visible and incomplete
if the bounded cooldown/retry budget cannot recover it. The next coverage
sharp edge is the three non-enumerable routes above.
