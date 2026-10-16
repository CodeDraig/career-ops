# Indeed through the Browser Harness Chrome extension

Interactive agents can run `indeed` mode. In the web app, open **Explore → Indeed
jobs** to search by keywords and location, read a selected description, and
explicitly add a result to the pipeline. This reads one results page (up to 50
unique complete cards); it does not paginate, submit applications, or verify
that the employer is still hiring. Search and description reads never write
Career-Ops user files. Added jobs use the existing pipeline and scan-history
writers, including a separate data root.

## Configure the local connection

Use the extension-capable `CodeDraig/browser-harness` checkout, not
`ai-browser-use` or an upstream build without the extension backend. This
adapter requires Chrome; Firefox's structured page helpers do not expose the
JavaScript used by this extractor. No additional npm or Python dependency is
installed by Career-Ops.

The executable resolves from `CAREER_OPS_BROWSER_HARNESS_BIN`, otherwise from
`CAREER_OPS_BROWSER_HARNESS_ROOT/.venv/bin/browser-harness` (Windows uses
`.venv/Scripts/browser-harness.exe`), then the sibling `../browser-harness`
checkout, finally `browser-harness` on PATH. An explicit BIN is an executable
path, not a shell command.

Follow that project's `EXTENSIONS.md` to package/install the Chrome extension
and register its native messaging host. Existing installations can be reused.
Use the same `BH_CONFIG_DIR` as the native host if it has a nondefault config
location. Never copy the pairing token into a profile, prompt, URL, or log.

Start the bridge and click **Connect** in the extension popup:

```sh
BH_BACKEND=extension BU_NAME=career-ops browser-harness extension list
BH_BACKEND=extension BU_NAME=career-ops browser-harness extension select CONNECTION_ID
```

Select the Chrome connection if several profiles are connected. The core forces
`BH_BACKEND=extension`, disables domain skills and recordings, and defaults to
`BU_NAME=career-ops`. Set `CAREER_OPS_BROWSER_HARNESS_SESSION` to use an existing
named extension daemon instead. The bridge port is shared: do not start multiple
named daemons on the same endpoint. Direct-CDP and cloud fallback are disabled.
No Chrome remote-debugging toggle is required.

Export these settings in the shell that launches the interactive agent or web
server; restart the web server after changing its environment. For this local
installation, the existing native host uses:

```sh
export CAREER_OPS_BROWSER_HARNESS_BIN=/srv/data/code/browser-harness/.venv/bin/browser-harness
export BH_CONFIG_DIR=/srv/data/code/browser-harness/.browser-harness-dev/extensions/user-config
```

The browser and harness must run under the configured user session. The web app
calls the core executable from the code root, even when `CAREER_OPS_ROOT` points
to a separate data directory. It does not inherit the Codex integrated browser.

## Run a read

```sh
node indeed-search.mjs --keywords="support engineer" --location=Remote
node indeed-search.mjs --id=0123456789abcdef
```

The second command illustrates the job-key format; supply an ID from a result.
Both return JSON; failures exit nonzero. Only `ok`/`empty` mean a completed read.
`challenge`/`login_required` require human action in the retained Chrome tab;
`unavailable` means changed/unreadable content, never an empty result.
`browser_unavailable` means check the extension connection with:

```sh
BH_BACKEND=extension BU_NAME=career-ops browser-harness extension status
```

A search opens a new tab and closes only that tab after a successful read.
Failed/challenge tabs stay open for inspection. Career-Ops calls are serialized
across processes; a concurrent request returns `busy`. Avoid driving this same
extension connection with another harness client during a search, since the
harness maintains one selected tab. Disconnects/timeouts are never replayed.
Results are untrusted source text and employer openings remain unconfirmed.
