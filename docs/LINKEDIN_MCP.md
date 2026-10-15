# LinkedIn MCP in interactive Career-Ops sessions

Career-Ops uses the LinkedIn MCP already enabled in your interactive agent host.
No separate Career-Ops installation, credential copy, or `plugins.mjs enable`
step is needed. The host must expose `search_jobs`, `get_job_details`, and
`get_job_apply_url` and have a usable LinkedIn session. If tools are disabled or
authentication is needed, the agent reports that state for you to resolve.

Examples:

```text
Run career-ops linkedin: search for support engineer jobs, remote work only.
Search LinkedIn for support engineer jobs in the United Kingdom, remote only.
Show the full description for job 4473900227.
Evaluate that selected job with career-ops oferta.
Show its application link.
```

Slash-command hosts can use `/career-ops linkedin`. Natural-language LinkedIn
search requests route to the same mode. A pasted job URL still follows the
existing evaluation route, preferring the enabled MCP in an interactive session.

Search starts with one page and displays dropped-filter/partial-result warnings.
Remote work and geographic location are separate constraints. Search is read-only;
selected jobs can be handed to the existing evaluation modes with their original
JD and provenance. Evaluation retains the employer-confirmation gate and normal
data-root handling. Missing descriptions stop evaluation rather than triggering
another LinkedIn extraction attempt. Account writes and application submission
are not part of this integration.

The workflow lives in [modes/linkedin.md](../modes/linkedin.md), registered by the
shared Career-Ops skill router. It adds no web Explore screen, headless worker,
standalone MCP launcher, automated scanner or new dependencies. The existing
offline `linkedin-join.mjs` connections-export workflow remains separate.

Live verification on 2026-10-15: the connected server returned job IDs and title
references for support-engineer searches, a selected full job description, and
an external application URL. One search reported that LinkedIn dropped its
location filter; that warning is part of the workflow contract. This verifies
the current read path, not future session renewal or every search filter.
