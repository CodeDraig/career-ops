# Career-Ops with Chrome and a browser desktop

The container runs the production web app, core scripts, Chrome for Testing,
Browser Harness's Chrome extension/native host, and a virtual desktop accessible
through noVNC. Chrome does not need a remote-debugging port. The default image
also includes Codex, the compiled Go dashboard, Chromium for PDF generation,
and LaTeX. It currently targets Linux amd64.

## Build and start

Install Docker with Compose supporting `build.additional_contexts`. Keep the
extension-capable [CodeDraig/browser-harness](https://github.com/CodeDraig/browser-harness)
checkout alongside Career-Ops, or set its path before building:

```sh
export CAREER_OPS_BROWSER_HARNESS_SOURCE=/absolute/path/to/browser-harness
./cops up --build
```

`docker compose up -d --build` is equivalent. The build copies only the harness's
package metadata, lockfile and `src/`; its browser profiles and local research
files are not included. Career-Ops sources are filtered by `.dockerignore`.
The web dependency lock is respected. The root package has no committed npm
lockfile, so its declared dependency ranges resolve at build time. Chrome's
version and archive checksum, Codex and uv versions are pinned in `Dockerfile`.

Open:

- Web app: <http://localhost:3010>
- Chrome desktop: <http://localhost:6080/vnc.html?autoconnect=true&resize=scale>

In the Chrome desktop, click **Connect** on the Browser Harness page. The native
host and bridge are already registered inside the container. Sign into Indeed
in this dedicated browser when needed. The same connected profile serves
interactive `indeed` mode and web Explore. On later starts the extension's
saved connection choice reconnects automatically; an explicit **Disconnect**
remains respected. If the page says disconnected, click Connect again.

The desktop also shows the browser windows opened by application autofill.
Review the form there and submit it yourself. Chrome profiles used by autofill
remain separate from the persistent Indeed profile; autofill does not acquire
that profile's cookies automatically. Active application-autofill sessions
are in memory and end when the container restarts; saved user files remain.

## Persistent data

Compose creates two named volumes:

| Volume | Container path | Contents |
|---|---|---|
| `career-ops-data` | `/data` | CV/profile, tracker, reports, PDFs, mail caches/cursors/outbox/receipts and other user files |
| `career-ops-home` | `/home/node` | Chrome profile, Browser Harness pairing/configuration, downloads and CLI credentials/configuration |

The names are prefixed by the Compose project name. Container replacement and
`docker compose down` keep them. **Do not run `down -v`** unless you intend to
remove these volumes. Back up both while the container is stopped. The image
contains no personal profile, mail configuration or host Chrome cookies.

The image runs as uid/gid 1000. For an existing data directory, use an absolute
bind source and preserve its existing absolute path inside the container:

```sh
export CAREER_OPS_DATA_SOURCE=/absolute/path/to/your/career-data
export CAREER_OPS_CONTAINER_DATA_ROOT=/absolute/path/to/your/career-data
docker compose up -d
```

That directory must already be writable by uid 1000. Do not recursively change
ownership of your files to work around this: use an appropriately owned copy
or adapt the image user for your installation. Keeping the same canonical
tracker path preserves confirmed mail matches and frozen send identities.
Moving it requires reviewing matches and preparing affected drafts again.
Empty storage is intentionally empty: use the existing onboarding workflow;
startup never copies personalisation templates over existing files.

All writers should run through this container. The core's PID-based lock
recovery assumes one PID namespace; do not run simultaneous host or separate
container writers against the same data volume.

## Commands and integration credentials

```sh
./cops shell
./cops doctor
./cops scan
./cops node mail.mjs --help
./cops browser-harness extension status
./cops career-dashboard --path /data
./cops codex login --device-auth
```

Raw commands execute in `/opt/career-ops`. Use absolute `/data/...` paths for
arguments that are relative to the working directory, such as PDF input files.
The `CAREER_OPS_ROOT` environment variable already selects the user data volume.
CLI configuration/login state persists in the home volume. Host-agent MCP tools
are not inherited: configure LinkedIn MCP in the container's agent if needed.
No AI account login or paid model call is performed at startup.

For mail, place `config/mail.json` under the mounted data root as described in
[MAIL.md](docs/MAIL.md). Pass each account's `secretEnv` name in a private Compose
override, for example:

```yaml
services:
  career-ops:
    environment:
      CAREER_MAIL_PASSWORD: ${CAREER_MAIL_PASSWORD:?Set your mail app password}
```

Store the override outside this checkout and invoke Compose with both files.
Mount any custom CA bundle at the same path named in `caFile`. Secrets belong
in runtime environment/configuration, never the Dockerfile, build arguments,
image or source control. OAuth token acquisition/refresh remains outside the
mail transport. Sync remains manual and Send requires explicit review.

## Lifecycle and access

```sh
docker compose restart
docker compose down                 # keeps user data and Chrome profile
docker compose up -d                # starts them again
docker compose up -d --build         # deploy changed application sources
docker compose logs -f
```

Rebuild the image to update code and dependencies; in-container self-update is
not the deployment mechanism. A failing supervised service stops the container;
Compose's restart policy restarts the stack. Shutdown lets Chrome flush its
profile before stopping the display and bridge. An advisory lock prevents two
Career-Ops containers from sharing the browser profile concurrently. After that
lock is acquired, stale Chromium singleton links from the previous container
are preserved under `/home/node/.local/state/career-ops/chrome-locks/`, with a
receipt; cookies, extension state and other profile files stay in place. The health check checks web and
desktop availability; an unconnected extension is an onboarding state, not a
reason to restart Chrome or replay browser actions.

The persistent extension browser runs as the unprivileged container user with
its sandbox enabled. The
vendored syscall profile is Playwright v1.63.0's [Docker profile](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json),
SHA-256 `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
It allows Chromium to create user namespaces without privileged mode or
`SYS_ADMIN`. Its source is Apache-2.0 licensed by Microsoft.

Both published ports bind to host loopback. noVNC is a full desktop with access
to the browser's signed-in accounts; keep it private. To use a remote host,
forward ports 3010 and 6080 through SSH, or put authenticated access in front of
both. Internal VNC and the extension bridge are not published. Override local
ports with `CAREER_OPS_WEB_PORT` and `CAREER_OPS_DESKTOP_PORT`.

Containerised Chrome can still encounter site login requirements or challenges.
Use the desktop to resolve those; no session is borrowed from the host browser.

## Verification and host network limits

Run `python3 container/test-entrypoint.py` for the offline startup/shutdown
regressions. Builds also check runtime imports from the filtered source tree
and compile the production web app and Go dashboard. For acceptance, use a
separate Compose project and fresh volumes, then verify web/desktop access,
extension connection, fixture mail, PDF rendering, and persisted files/cookies
after `restart` and `up -d --force-recreate`. The extension needs one explicit
Connect action in a new profile. Do not copy a real browser profile into tests.

If Docker reports `all predefined address pools have been fully subnetted`,
inspect host routes and `docker network inspect` to choose an unused subnet.
Use the optional network override rather than changing global Docker settings:

```sh
export CAREER_OPS_SUBNET=172.16.241.0/24  # example only; check it is unused
export COMPOSE_FILE=docker-compose.yml:container/network.compose.yml
./cops up --build
```

Leave that override selected for later lifecycle commands.
