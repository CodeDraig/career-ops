# Automation validation — 2026-10-23

The implementation is deployed to Thomas, Courtney, and Brandon. All three containers
are healthy on image `sha256:6268d399ab0b2413f274d9d2d96efae565695a1b444f64c3c373b3c5ee2bf213`.
Automation is disabled pending each person's own setup. Personal live readiness has
not been demonstrated.

The approved [phase plan](../IMPLEMENTATION_PLAN.md) is preserved separately. The
[automation guide](AUTOMATION.md), [mail guide](MAIL.md), and [Docker guide](../DOCKER.md)
describe configuration and operation.

## Implemented behavior

- A persistent supervised worker runs saved schedules, bounded source recovery, role
  packets, mailbox polling, draft preparation, and a local daily digest.
- Versioned private state records typed tasks, leases, immutable attempts, checkpoints,
  input fingerprints, budget reservations, reviews, and fixed mailbox lookback dates.
  The hard daily caps are 20 roles and 20 draft versions, with default 10/10 new/backlog
  role cohorts and borrowing. Evaluation and document stages share their allocation.
- CLI and web review use the same core services. Revision guards reject stale approval
  requests. Existing canonical tracker writers, fenced launchers, English modes, mail
  transports, and document renderers remain authoritative.
- Background work does not send email, submit applications, approve matches/statuses,
  rewrite portals, or execute arbitrary agent-inbox instructions. LinkedIn remains
  interactive-only. New browser liveness reads use the Chrome extension.

## Repository and Docker checks

| Check | Command or evidence | Result |
|---|---|---|
| Root suite | `node test-all.mjs` | Latest full run: 12,937 passed, two help-output assertions failed, 18 warnings; full-root gate remains unresolved |
| Web suite | `CAREER_OPS_BROWSER_TESTS=1 npm --prefix web test` | 1,198 passed, zero failed, two fixture-URL browser suites excluded |
| Web typecheck | `npm --prefix web run typecheck` | Passed |
| Web production build and image | `docker buildx build --build-context browser-harness=/srv/data/code/browser-harness -t career-ops:automation-2026-10-23 --load .` | Passed |
| Dashboard | `go test ./...` and `go build` in `dashboard/` | Passed |
| JavaScript syntax | `node --check` over 1,221 MJS files | Passed |
| Container lifecycle | `python3 container/test-entrypoint.py` | Six passed |
| Python syntax | `python3 -m py_compile` for the changed Python helpers | Passed |
| Update inventory | `node validate-system-paths-coverage.mjs` | 2,019 tracked paths covered |
| Docker fixtures | `docker run --network none ... container/test-automation-acceptance.mjs` | Passed; worker restart, scheduler, role packet, mail draft, persistent state and zero SMTP delivery |
| Docker regressions | Node tests for state, worker, service, recovery, mail, pipeline, launcher and scheduler | 85 applicable tests passed |
| Final rendered web smoke | Read-only `/automation` in ports 3013, 3014 and 3015 | Each showed disabled setup, five repairs, max=20 controls, zero browser errors |

The two web-suite exclusions were loading transitions and inline Pipeline status;
separate disposable-browser runs passed six and nine checks respectively. The Docker
regression subset initially failed one host-only assertion that execution outside
Docker must be refused. That assertion passes on the host; it was excluded only from
the applicable Docker rerun. The original failure log is retained.

The updater rollback/template suite passed all five subtests in an explicit TAP run
and in three exact default-runner reproductions under a 30-second timeout (16–19 s).
The prior completed full run had 12,938 passing checks and one updater-fixture failure
without captured assertion detail. The latest completed full run then reported two
missing/unequal `check-liveness -h` output assertions. Twenty help
calls under each of host Node 26 and copied container Node 24 returned identical
436-byte output, and five focused fixture runs per runtime passed. A later diagnostic
parent itself failed to flush output in its 30-second tool window. At that point host
load was about 87 with all 32 GiB of swap occupied. Host contention is consistent
with the failures; the exact cause remains unconfirmed. The help fixture now reports
status, signal, error code, elapsed time and stderr on failure, while retaining its
10-second timeout and all original assertions. Its changed focused run passed 13/13.
Updater behavior and assertions were not changed. The full-root gate is not green.
It needs another full run when host pressure has cleared; the copied supported Node
24 runtime can provide a controlled comparison. No global process or machine setting
was changed to force that result.

Earlier verification found and corrected the shared lock-release race, reservation
recovery before AI launch, retries at a full allocation, concurrent fact edits during
document drafting, contradictory source-completeness receipts, and the extension's
HTTP(S)-only tab-creation contract. The final UAB liveness read returned active via an
Apply control in the deployed image; no application action was taken.

Two unrelated opt-in H1B checks were not run: the live API probe (`H1B_API_TEST`) and
token mint (`H1B_MINT_TEST`, limited to two keys per address per day). Root warnings
also include expected absent-CV behavior and public-name matches.

## Final simultaneous 346-school run

The final image ran the inventory concurrently in all three containers. Inventory
SHA-256: `c2074cf282a5b3f5c8d70007b76d6f97122f7b819fff291a01080c562b715284`.
Each original run and failed-only recovery is preserved separately. Combined coverage
counts only complete working or verified-empty searches.

| Instance | Initial coverage | After failed-only recovery | Full-run duration | Average CPU cores | Mean RAM | Peak RAM |
|---|---:|---:|---:|---:|---:|---:|
| Thomas | 339/346 (97.98%) | 341/346 (98.55%) | 604 s | 1.40 | 1.60 GiB | 2.49 GiB |
| Courtney | 340/346 (98.27%) | 341/346 (98.55%) | 614 s | 1.39 | 1.62 GiB | 2.52 GiB |
| Brandon | 340/346 (98.27%) | 341/346 (98.55%) | 588 s | 1.41 | 1.59 GiB | 2.51 GiB |

Each combined result has 335 working searches, six verified empty boards, two errors,
and three unresolved sources. Ten initial incomplete results were retried across the
three instances. Houston City College's pagination failures and UA Global Campus's
missing empty-result evidence recovered. Both Georgia searches remained incomplete:
Southern Crescent Technical College and Chattahoochee Technical College. Upper Iowa
University, University of the People, and Doral College remain unsupported sources.

The Georgia diagnosis records the public page's changed view identifiers and new
search guard. The cause remains an inference; no portal configuration or automatic
challenge handling was added. Five persistent source-repair reviews per inbox retain
the evidence and required action.

All 57 Workday boards completed in each instance. The receipts capture 764, 763 and
763 HTTP calls respectively. Thomas recorded one Grossmont HTTP 502 followed by an
identical successful call: one observed retry sequence. Retry ordinals are not emitted,
so a complete count of framework retry layers cannot be inferred from these receipts.

The aggregate sampled peak was 7.52 GiB across the three containers. None restarted or
was OOM-killed. The 120 samples include startup and the idle tail; CPU core averages
use cgroup CPU time. Other host builds, tests and scratch probes were active, so this
is an observed concurrent workload, not an isolated capacity benchmark.

## Persistence, preservation and remaining acceptance

A scratch-only probe of the final image preserved config/state hashes, a started
budget marker, a review item, and a persistent Chrome cookie through container restart.
Rollback to image `sha256:509e8913…` served the manual app successfully on the same
scratch volumes and preserved those records and the cookie. Chrome rewrote its SQLite
cookie file on startup; logical cookie persistence was verified rather than identical
SQLite bytes. Both probe containers remain stopped and retained.

The three real instances retain their named data/home volumes and prior containers.
Fifteen relevant source-file hashes match the workspace in each deployed instance.
No active automation config, profile, CV, portals, mail config, canonical tracker, or
saved Codex login was created. Public validation receipts, worker heartbeats, and the
explicit repair reviews are the new per-instance data. The changed-path manifest has
74 system/test/documentation paths and no protected existing user-layer file.

Thomas must still receive his real CV, targeting/profile, portals, mail configuration,
and own Codex login. Then run a real job packet and draft-only mail workflow and
observe a daily cycle before enabling Courtney and Brandon independently. Those live
checks and the 24-hour cycle are **not run**, not passed. Phase 6 remains incomplete
for these prerequisites and the unresolved full-root gate. Settings default to disabled,
America/New_York, blank model/effort overrides, and no selected mailbox accounts.

A crash immediately after the durable AI-start marker but before process spawn is
conservatively charged. A text-CV mode may leave an artifact when facts change during
its run; the packet blocks instead of presenting that artifact as fresh, and retains
it for review. These are documented limits of the checked behavior.

## Evidence

All local evidence is under
`/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/`:

- [Final run, coverage, HTTP and resource analysis](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/full-final-analysis.json)
- [Original final-run receipts](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/full-final/run.json)
- [Failed-only recovery receipts](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/full-final-recovery/)
- [Final deployment and retained containers](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/deployment-v2.json)
- [Runtime/code/volume checks](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/final-runtime.json)
- [Final-image restart/rollback](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/hostevidence/restart-probe-final/evidence/acceptance-summary.json)
- [Browser screenshot](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/host-thomas-automation-final.png)
- [Georgia source diagnosis](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/full-recovery/georgia-diagnosis.md)
- [Updater focused reproductions](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/hostevidence/updater-repro.json)
- [Host execution diagnosis](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/checks/host-execution-diagnosis.json)
- [Captured repository checks](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/checks/)
- [Changed paths](/home/cadwaladyr/Downloads/career-ops-automation-2026-10-23/changed-paths.txt)

No commit or push was requested or performed for this implementation.
