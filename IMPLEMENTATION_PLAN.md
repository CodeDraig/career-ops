# Automate scheduled searches, mail triage, recovery, and review packets

## Summary

Implement the four selected automation features using Career-Ops’ existing scanners, mail transports, evaluation modes, document generators, and Codex launcher.

Each instance will have a persistent worker that runs saved schedules, recovers failed searches, prepares job packets, and drafts mail for review. Results will appear in a shared web and CLI inbox, with a daily digest. Sending email and submitting applications remain explicit user actions.

The agreed operating limits are:

- **20 roles and 20 mail drafts per instance per day.** Evaluation and qualifying document generation share a role’s allocation.
- **10 new-role slots and 10 existing-backlog slots**, with borrowing when the other group has no eligible work waiting.
- **Codex CLI**, using each instance’s own authentication and configured model, otherwise its CLI default.
- **Web and CLI review**, without outbound notifications.
- **Thomas first**, followed by Courtney and Brandon after their individual setup and validation.

Current inspection found Codex installed in all three containers, but their standard CV, profile, portals, mail configuration, and saved Codex authentication files are absent. Activation therefore requires completing those inputs and verifying authenticated access. This planning pass changed no files and ran no tests.

## Phased implementation

### Phase 1 — Build persistent automation state and reusable execution

**Deliverable:** resumable automation tasks that use the same execution paths as existing interactive workflows.

- Add a core `automation.mjs` CLI with `worker`, `status`, `pause`, `resume`, `retry`, and `review` commands. Support `worker --once` for tests and external schedulers, and JSON output for status and review inspection.
- Store explicit user settings in `{DATA_ROOT}/config/automation.json` and versioned automation state beneath `{DATA_ROOT}/data/automation/`. Register these as user-owned data in the Data Contract.
- Use existing atomic writes and resource locks. Persist task identity, input fingerprints, state, attempts, lease ownership, budget reservations, results, and review references. Keep attempt receipts immutable.
- Support queued, running, retry-waiting, blocked, review-ready, completed, failed, and cancelled states. Blocked tasks carry a specific reason and required action.
- Extract reusable headless execution from the current web run route. Both web requests and background tasks must use the existing fenced launcher, prompt builders, report validation, document rendering, and canonical writers.
- Preserve existing interactive behavior and streaming responses. Background execution must not introduce another scoring engine or a separate tracker writer.
- Give tasks stable identities based on their source and work type. Duplicate discoveries, repeated scheduler ticks, and process restarts must not create duplicate reports, drafts, or budget charges.
- Restrict background execution to the selected task types. Do not automatically execute arbitrary free-text instructions from the existing agent inbox.

**Acceptance gate:** isolated-data-root tests demonstrate duplicate suppression, concurrent claims, stale-lease recovery, crash recovery, input-change detection, and unchanged interactive execution.

### Phase 2 — Run saved schedules inside each container

**Deliverable:** saved searches execute without an external cron job or an open web session.

- Start the automation worker under the existing container supervisor. Check for due work every 60 seconds.
- Reuse the saved-schedule store and queue. Refactor the current one-shot scheduler runner into a callable operation while retaining its command-line entry point and existing Windows scheduling support.
- Preserve existing schedule timezones, pause controls, missed-run handling, and claim protection. Manual “Run now” and automatic execution must claim through the same queue.
- Allow one automated scan, one AI task, and one mailbox sync at a time per instance. Keep browser-backed work serialized within each instance and retain Browser Harness’s extension and tab coordination.
- Report worker heartbeat, active work, last successful runs, blocked prerequisites, and remaining daily allocations through the scheduler/status UI.
- Missing profiles, mail configuration, or authentication must block the dependent workflow visibly. They must not trigger container restart loops or copy onboarding templates.
- On shutdown, stop claiming work and checkpoint or terminate active subprocesses before Chrome and Browser Harness close, within the existing container stop window.
- Extend health checks with worker liveness when automation is enabled. Health checks must not contact a mailbox, job board, or model.

**Acceptance gate:** a scheduled scan runs inside Docker, survives a restart without duplicate execution, respects pause/resume, and leaves browser profiles and user files intact.

### Phase 3 — Recover failed searches and retain repair tasks

**Deliverable:** transient source failures recover automatically; persistent failures produce actionable review items.

- Extend the existing scan receipt support with an optional detailed run-receipt file shared by the portal and full ATS scanners. Preserve existing default stdout formats and consumers.
- Record stable source identity, provider, effective configuration, completeness, added URLs, warnings, and typed errors. Retain successful-source outcomes so recovery can distinguish a partial scan from a complete one.
- Retry only the failed source through the same provider, filters, deduplication, and pipeline-writing logic. Do not rerun an entire successful sweep.
- Permit two delayed recovery attempts, after 5 and 30 minutes, honoring a longer `Retry-After`. Retain existing provider retries and shared Workday pacing; record both layers so retries remain bounded.
- Restart browser pagination from page one in a fresh search context. Treat repeated pages, stalled pagination, and extraction failures as incomplete results.
- Route login requirements and browser challenges to a blocked review item. Do not add debugger access, change browser authentication, or attempt automatic challenge handling.
- Reuse existing portal-health history and failure classifications. Persistent failures create repair items containing the source, attempts, evidence, and available discovery or configuration suggestions.
- Require review before applying a proposed portal configuration change. Automated diagnosis must not silently replace an employer’s board or run unbudgeted AI repair sessions.
- Add failed-only recovery to college validation. Preserve the original run and separate recovery receipts, then produce an explicitly identified combined coverage result.

**Acceptance gate:** fixtures cover rate limits, transient server errors, malformed responses, browser pagination failures, valid empty boards, authentication blocks, and unsupported routes. Recovery must preserve employer scope, pagination completeness, and original evidence.

### Phase 4 — Add background mail triage and drafting

**Deliverable:** configured mailboxes produce reviewable reply suggestions, status proposals, and follow-up drafts.

- Poll each enabled account/mailbox every 15 minutes through the existing IMAP core. Persist a fixed initial lookback date—seven days before activation—so polling does not reset cursors with a moving date.
- Fetch up to two pages of 50 messages per poll. Continue an unfinished catch-up on subsequent worker ticks using the existing cursor.
- Preserve read-only mailbox access, message persistence before cursor advancement, and UIDVALIDITY recovery.
- Reuse reply classification and tracker matching. Suggestions remain suggestions; only an explicitly confirmed association, or its established thread association, can bind a message to an application.
- Add an IMAP-capable version of reply proposals while retaining support for existing Gmail proposals. Preserve tracker-path binding, application identity, evidence references, and stale-state checks.
- Draft actionable recruiter replies first, then eligible overdue follow-ups using the existing cadence calculator. Put job alerts, noise, and messages without an appropriate response in the digest without consuming a draft allocation.
- Missing recipients, uncertain application matches, factual gaps, or availability questions become review items. Drafts must not invent answers.
- Run mail drafting through a read-only Codex capability. Supply source-backed user context and treat incoming mail as untrusted content. Exclude mail credentials and interactive MCP integrations from AI workers.
- Store draft versions and their context fingerprints. A new reply, changed application state, or edited source facts must invalidate the affected pending draft.
- Open approved drafts in the existing composer. Keep Prepare and explicit Send, including the reviewed digest and send-receipt protections. Recheck freshness when preparing and sending an automation-generated draft.
- Keep status proposals behind explicit approval through the existing canonical status writer. Do not log a follow-up as sent until SMTP acceptance is recorded.

**Acceptance gate:** local IMAP/SMTP fixtures verify incremental sync, cursor recovery, matching, stale drafts, proposal approval, and send-receipt behavior. Background runs must produce zero SMTP deliveries.

### Phase 5 — Prepare job packets and provide the shared review inbox

**Deliverable:** eligible discoveries and pending URLs become complete review packets without manual handoffs.

- At first activation, record the existing pending-URL cohort as backlog. Subsequent discoveries enter the new-role cohort. Preserve original ordering and arrival evidence.
- Allocate 10 daily role slots to each cohort. When both have work, serve the less-used cohort; when one has no eligible work, allow the other to borrow. Later arrivals do not reopen an exhausted daily allocation.
- Recheck liveness, blacklist rules, filters, duplicate identity, and existing processing state before AI work. Uncertain eligibility and agency-confirmation gates create review items.
- Execute the existing English baseline pipeline. Preserve its evaluation, report archival, provenance checks, and canonical tracker updates.
- Generate documents according to existing configuration: the current CV threshold, selected formats, and application-answer threshold remain authoritative.
- Reserve daily allocations atomically before AI execution. A role uses one slot per day across its evaluation and document stages; started failures count, preflight blocks do not. Bound retries to three attempts per AI stage and prevent retries from bypassing daily limits.
- Apply the 20-draft daily allocation to new draft versions, with bounded retries recorded against their reservation. These are workload limits, not a guaranteed dollar spending ceiling.
- Add persistent web and CLI review views for job packets, mail drafts, application matches, status proposals, source repairs, and required input.
- Provide list/detail actions through `/api/automation` and its review endpoints. Approval requests must include the expected item revision; stale requests return a conflict and the current context.
- Delegate actions to existing core services: confirm a mail match, approve a status proposal, open a draft, answer a pipeline question, retry a task, or mark a packet reviewed. Marking a packet reviewed must not mark an application Applied.
- Create one local daily digest at 08:00 in the automation timezone, containing activity since the previous digest, ready items, blockers, exhausted allocations, and unresolved source failures. Review items appear immediately.

**Acceptance gate:** end-to-end fixtures take a discovery and a backlog URL through evaluation, qualifying documents, canonical writes, and review. Tests cover quota rollover, borrowing, concurrent manual edits, interrupted stages, and repeated discoveries.

## Verification and rollout

### Phase 6 — Validate the complete workflow, then activate each instance

1. **Run isolated tests.** Cover external data roots, tracker overrides, concurrent web/background activity, atomic approvals, worker restart recovery, quotas, and strict separation of instance data. Synthetic profiles and mail fixtures stay outside real user volumes.

2. **Run repository checks.** Execute root tests and syntax checks; web tests, typecheck, and production build; dashboard Go tests/build; and the full Docker build. Report failures and skipped checks explicitly.

3. **Exercise Docker workflows.** Verify scheduled execution, mailbox catch-up, draft preparation, packet generation, review actions, and worker/browser restart persistence. Confirm that no background path sends mail or submits an application.

4. **Activate Thomas as the canary.** Complete its real profile, portals, mail configuration, and Codex login without copying another person’s credentials or data. Verify authenticated CLI readiness, run one real job packet and one draft-only mail workflow, then observe a full daily scheduling cycle.

5. **Enable Courtney and Brandon independently.** Require their own prerequisites and run the same smoke checks. Preserve existing volumes, browser profiles, prior images, and a recoverable pre-rollout state. Leave unrelated containers untouched.

6. **Repeat the simultaneous 346-school validation.** Run all three containers together, retaining initial results and recovery attempts separately. Measure CPU, memory, duration, retries, worker restarts, and browser failures. Calculate coverage from current evidence; do not force the previous percentage or count unsupported routes as successful empty searches.

7. **Verify rollback.** Pause automation and restore the prior image while retaining canonical files and automation records. Confirm existing manual workflows still operate.

Completion requires both passing implementation checks and demonstrated live readiness. An instance missing real configuration or authentication remains explicitly blocked rather than reported as enabled.

## Defaults and boundaries

- Automation timezone defaults to `America/New_York`; saved searches retain their individual timezones.
- Each instance uses its own Codex authentication. Background configuration excludes interactive MCP integrations while preserving the selected model and effort settings.
- LinkedIn remains interactive-only. Browser automation uses the existing Browser Harness Chrome extension.
- Shared public-board caching and outcome-driven search allocation are outside these four features.
- OAuth token acquisition/refresh, automatic portal rewrites, outbound notifications, email sending, and application submission are outside unattended execution.
- Existing user files are not migrated or rewritten during activation. New automation settings are created only through explicit enablement.
