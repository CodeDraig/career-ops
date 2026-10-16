# IMAP/SMTP mail

Career-Ops supports provider-independent mail in interactive `mail` mode and the
web **Mail** screen. Gmail's existing read-only plugin remains available. The
`email` mode still only drafts; sending is a separate reviewed action.

## Configure an account

Python 3.11+ is required (`python3 --version`). No Python packages are needed.
Copy `config/mail.example.json` to **your data root** as `config/mail.json`, then
set host, port, user and From address. The file is user-owned and gitignored.
Do not overwrite an existing configuration. `CAREER_OPS_ROOT` / `CAREER_OPS_DATA_DIR`
and `.career-ops-data` use the normal path resolver. `CAREER_OPS_MAIL_CONFIG` may
specify another file (use an absolute path; relative paths use process cwd).

Set each `secretEnv` environment variable in the process launching Career-Ops or
the web server. Keep secrets out of profiles, command arguments, chat and Git.
Use a provider-issued app password where required. `auth: "oauth2"` accepts an
already-issued access token through the same environment variable using XOAUTH2;
token acquisition and refresh are not implemented.

Each account has a stable `id`, plain email `from`, and optional `imap` and `smtp`
objects. Transport fields are `host`, integer `port`, `user`, `secretEnv`,
`security` (`tls` for implicit TLS, or `starttls`), and optional `auth` (default
`password`) and `caFile` (absolute path to a trusted CA bundle for self-hosted mail).
Typical ports: IMAP TLS 993, IMAP STARTTLS 143, SMTP TLS 465, SMTP STARTTLS 587.
Certificate verification is always enabled; plaintext transport is unavailable.

## Interactive JSON interface

Run `node mail.mjs --request < request.json`. Requests and responses are JSON.
The web uses this same core, with no separate mailbox or sending implementation.

```json
{"action":"accounts"}
{"action":"fetch","account":"personal","mailbox":"INBOX","since":"2026-10-01","limit":20}
{"action":"import","id":"BATCH_UUID","ids":["imap-MESSAGE_HASH"]}
{"action":"lead","id":"BATCH_UUID","messageId":"imap-MESSAGE_HASH","url":"https://example.com/jobs/123"}
{"action":"prepare","account":"personal","draft":{"to":["recruiter@example.com"],"cc":[],"bcc":[],"subject":"Application","body":"Reviewed email text","attachments":[]}}
{"action":"history"}
{"action":"review","id":"PREPARED_UUID"}
{"action":"send","id":"PREPARED_UUID","confirm":"REVIEWED_SHA256_DIGEST"}
```

Submit one object per invocation. Attachments use
`{"name":"cv.pdf","dataBase64":"BASE64_FILE_BYTES"}`. The web reads only files
you select in its file picker. Maximum: 10 attachments, 10 MB total; body 100,000
characters. From is fixed by the chosen account. To/Cc/Bcc accept plain ASCII addresses,
not display-name syntax. Bcc recipients are included in the SMTP envelope but not
in message headers. Preview all recipients and content before authorizing Send.

## Reading and review

Fetching uses IMAP EXAMINE and BODY.PEEK: no Seen flags, deletion, expunge or moves.
The date filter is IMAP SINCE (mailbox internal date, day granularity), with at
most 50 recent messages. Messages larger than 5 MB are skipped; bodies beyond
20,000 characters are marked truncated. MIME headers and text are decoded; HTML
is converted to text without loading images or running scripts. Attachments are
listed by name only. Non-ASCII mailbox names may require the provider's IMAP
modified-UTF-7 spelling; automatic mailbox discovery is not implemented.

Fetching saves a local snapshot under `data/mail/outbox/` (kind `inbox`). Selected
imports append under the existing reply-candidate lock, deduplicating by server,
user, mailbox, UIDVALIDITY and UID. A UIDVALIDITY reset creates new identities;
no message is deleted from the server. `CAREER_OPS_REPLY_CANDIDATES` overrides the
usual `data/reply-candidates.json` path. Malformed existing data fails visibly.
Run reply-watch to classify imported replies and review proposed tracker changes.
Selected source links go through the existing pipeline and scan-history writers;
links may be tracking/unsubscribe links, so inspect the destination before adding.

## Sending and recovery

Preparing freezes the MIME message and attachment bytes in a private local file.
Sending verifies the digest and unchanged SMTP configuration, then saves a receipt
**before** contacting SMTP. The same prepared ID cannot be sent twice, even after
failure, concurrent requests or a process crash. The web's Send button submits
only the frozen preview; later compose-field edits need another Prepare.

Receipt states: `accepted` (SMTP accepted all recipients), `partial` (accepted and
refused recipient lists), `unknown` (a connection failure or interrupted attempt;
delivery may have happened). Inspect the provider before preparing a replacement.
Receipts survive page reloads: use **Load saved emails** in the web app or `history` and `review` in the CLI. Neither sending nor
importing marks an application Applied, and no sent-folder copy is appended over
IMAP. Provider-side sent copies vary. No delivery/read receipt is claimed.

`config/mail.json` and `data/mail/` are user data. Snapshots include private message
bodies and attachments; they remain locally until you deliberately archive or
remove them. New files use mode 0600. Never commit snapshots or credentials.

Protocol implementation uses Python's standard-library
[imaplib](https://docs.python.org/3/library/imaplib.html),
[smtplib](https://docs.python.org/3/library/smtplib.html), and
[email](https://docs.python.org/3/library/email.html).
