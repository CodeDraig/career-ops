# Georgia searches and LinkedIn application links — 2026-10-23

**Current successful college coverage: 343/346 = 99.13%.** Both Georgia failures
from the earlier full Docker run now complete. The combined inventory contains
**337 non-empty searches, six verified empty searches and three unresolved schools**.

This is a two-school follow-up to the [full 346-school Docker run](CONTAINER_VALIDATION_2026-10-23.md),
not another fresh visit to all 346 schools. The [coverage overlay](college-container-fixes-2026-10-23.json)
records the original ledger's SHA-256, both new result receipts, posting-list
hashes and the verified image. The other 344 school results retain their earlier
evidence and employer scopes.

The validator's `requests` counter covers native-provider trace hooks. It does
not count this browser recipe's AJAX requests; the retained browser evidence is
the complete posting inventory, its hash and reconciled pagination metadata.

## Georgia fixes and live results

| UNITID | School | Unique postings | Pages | Advertised total |
| --- | --- | ---: | ---: | ---: |
| 139986 | Southern Crescent Technical College | 84 | 5 | 84 |
| 140331 | Chattahoochee Technical College | 88 | 5 | 88 |

Both searches passed in a test container and again in the final built image.
The source URLs and agency identifiers are unchanged. Each posting's displayed
agency must match the requested employer. Duplicate pages, a changed total,
missing counts, and inventories above or below the advertised total fail without
emitting partial results.

`browser-job-search.mjs` now requests the anonymous Drupal results view
(`/views/ajax`, `jobs_search`, `block_2`), synchronizes the primary and results-form
filter names, supplies the explicit page size, and follows the current `rel=next`
pager. It renders the replacement HTML with page JavaScript disabled; it never
executes Drupal's returned commands. Repeated filters are retained.

The upstream site intermittently returns an HTTP-200 "No result found" fragment
without a count, including on known populated pages. This was reproduced on
repeated reads of the same page. Only that unverified response is retried, with
at most ten requests within the caller's existing per-page timeout (30 seconds
by default). Exhaustion remains an error. A count-less fragment is never counted
as a verified empty search. The upstream service can still outlast that budget.

## LinkedIn fixes and live results

The container's pinned `mcp-server-linkedin` 4.28.0 receives the reproducible
`container/linkedin-apply.patch` during the Docker build. `git apply --check`
must pass before it is applied. The host's plugin installation is unchanged.

Both failing postings now expose an external Apply **button** with no href.
When that control appears above the posting's description, the reader performs
one authenticated same-origin GET for that exact job record. It validates the
posting and application-state identifiers, preserves applied/closed precedence,
and uses the existing employer-URL validator. It does not click Apply, submit
anything, follow a redirect or load the employer's destination. Session cookies
and CSRF headers are never returned in the tool result.

| LinkedIn job | Live tool result |
| --- | --- |
| 4478864590 — SmartSights | `external`: `https://recruiting.paylocity.com/recruiting/jobs/Details/4554835/Smartsights-LLC/Technical-Support-Engineer` |
| 4474855623 — Customer.io | `external`: `https://job-boards.greenhouse.io/customerio/jobs/8246114?gh_src=258112aa1us` |
| 4475855200 — Viirtue | `easy_apply`, with no external URL |

The normal stdio MCP calls passed after recreating the container with its
existing data and home volumes, without another sign-in. These are three
posting-level reads, not exhaustive verification of every LinkedIn posting or
an application-submission test.

## Verification

Final runtime image:
`sha256:2a6b5f1b77872c86a8afd803a6efed754cf7edc74e4976eea12a5ba74744900b`.
The running `career-ops-linkedin-colleges` container is healthy on the existing
web and noVNC ports. `career-ops:local`, `career-ops:linkedin-colleges` and
`career-ops:georgia-linkedin-fixes` refer to this image. The previous local image
is retained as `career-ops:before-georgia-linkedin-fixes-2026-10-23`.

Commands and results:

- `docker buildx build --load --build-context browser-harness=/srv/data/code/browser-harness -t career-ops:georgia-linkedin-fixes .`: passed, including the production web build and checked LinkedIn patch. The unchanged Go build stage reused its previously successful build cache.
- `node test-all.mjs`: 12,891 passed, zero failed, 17 warnings. The warnings concern empty-data CV checks, the broad personal-name detector flagging proper names already present in repository files, and two opt-in H1B checks that were not enabled.
- `node scripts/check-syntax.mjs`: all 1,187 scripts passed.
- `node tests/browser-job-search.integration.mjs`: passed on the host and inside the final image. Georgia regressions cover a final partial page, repeated filters, false empty responses and recovery, wrong employers, truncated/oversized inventories and changing totals; existing recipes still pass.
- `/opt/linkedin/bin/python container/test-linkedin-apply.py`: eight Chromium tests passed inside the final image. They cover exact-record lookup, existing links, Easy Apply, unrelated controls, missing headings, visible and API applied/closed states, mismatched identities, HTTP failure, invalid destinations, changed posting routes and absent CSRF state. All fixture network requests are intercepted.
- `python3 container/test-linkedin.py` and `python3 container/test-entrypoint.py`: five tests each passed.
- Two invocations of `node container/validate-colleges.mjs --inventory /opt/career-ops/docs/college-container-validation-2026-10-23.json --output /tmp/georgia-final-image --school <UNITID>` inside the final image: both complete, with five pages each. Posting-list hashes, title/company fields, counts and URL uniqueness were checked after copying the receipts out.
- Normal stdio MCP `get_job_apply_url` calls for the three IDs above: passed after recreation.
- `python3 container/healthcheck.py` inside the running container and `git diff --check`: passed.

Initial verification caught Drupal's HTML response wrapper, incomplete pagination
and false empty responses; the request and paging handling were corrected before
the successful reruns. A fixture initially failed to await its navigation mock,
and another exposed a retry at the exact timeout boundary; both were corrected
and the affected tests rerun. An early validation command preceded completion
of test-container creation and was rerun after startup. Python unittest discovery
matched no hyphenated test filename, so both setup test files were run directly.
These initial failures remain in the raw logs.

Separate web and dashboard test suites were not rerun; their sources are
unchanged. The remaining 344 schools were not revisited during this follow-up.

## Preservation and remaining coverage gaps

No CV, user profile, tracker, report, live `portals.yml`, or source database was
changed. The original full-run ledger is byte-identical. Source database SHA-256
still matches the earlier full-run receipt:
`913b31191a624b65fe72c8fb858ffaffc9719aa1125f66062315bd89afe4276e`.
Only the dedicated container's persistent authentication/runtime state was reused.
No application, message or paid model request was submitted.

Changed implementation files are `browser-job-search.mjs`, `Dockerfile` and
`container/linkedin-apply.patch`. Regression changes are in
`tests/browser-job-search.integration.mjs` and `container/test-linkedin-apply.py`.
Documentation changes are `DOCKER.md`, the current-result introductions in
`docs/CONTAINER_VALIDATION_2026-10-23.md` and `docs/COLLEGE_FINAL_EIGHT_VALIDATION.md`,
this report, and `docs/college-container-fixes-2026-10-23.json`.

The three unresolved routes remain Upper Iowa University's stateful Jenzabar
posting links, the University of the People's volunteer-only source, and Doral
College's general application form. They need a stable posting resolver or an
enumerable paid-vacancy source before being counted. Shared employer boards
remain separate school routes and must not be summed as unique vacancies.

Raw logs, successful posting inventories, initial failures and MCP results are
retained at
`/home/cadwaladyr/Downloads/career-ops-georgia-linkedin-fixes-2026-10-23/`.
