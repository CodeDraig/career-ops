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

## Manual follow-up workflow

Both the interactive `mail` mode and web **Mail** screen use the same core:

1. **Sync** a selected account/mailbox from a chosen date. Results are cached
   locally in ascending IMAP UID pages. Another sync with the same date resumes
   the cursor; changing the date restarts the window for backfill. Each page is
   saved before its cursor advances. `hasMore: true` means another sync continues
   the work. Oversized messages are counted and skipped, including cursor
   advancement past those UIDs. Mailbox flags remain unchanged.
2. **Review application matches.** Cached messages show deterministic reply
   classification and suggestions from the existing application matcher. Choose
   an application to confirm the association. Ambiguous suggestions never select
   an application automatically. Confirmed conversation references can carry an
   association to later messages in the same account. Unmatching a message
   explicitly suppresses inherited association for that message.
3. **Reply or Reply All.** The core proposes recipients using Reply-To/From,
   excludes configured self addresses from Reply All, and preserves the parent
   Message-ID and References. Edit the draft before preparing it. A new follow-up
   can instead select an application and recipient directly.
4. **Prepare and review.** The frozen preview includes recipients, content,
   attachments, the application identity and whether follow-up logging is enabled.
   The core checks that the linked tracker row/path still matches before sending.
5. **Explicitly Send.** SMTP acceptance of an application-linked draft with
   `logFollowup: true` appends exactly one canonical follow-up row dated from the send receipt, clears
   that application's pinned next date, and advances
   cadence through the existing follow-up log. It does not change application
   status. A rejected recipient or uncertain connection is not a successful
   follow-up. The receipt records any local logging failure separately.
6. **Recover a local logging failure.** Review the saved receipt, or use
   `reconcile`. Recovery retries local receipt/thread/log bookkeeping only;
   SMTP is never retried. The `[mail-followup:<prepared-id>]` marker prevents
   duplicate log rows if the process stopped after append but before saving the
   receipt. Tracker changes during recovery require review instead of attributing
   a follow-up to a replacement row.

The web Follow-ups screen links each application to `/mail?appNum=N`. In Mail,
application filtering is separate from the draft's selected application. No
mailbox polling or automatic sending is scheduled by this feature.

Caches and cursors live in `data/mail/messages/` and `data/mail/cursors/` under
normal data-root resolution. The automatic log honors `CAREER_OPS_FOLLOWUPS`
using the existing follow-up writer's path convention. Confirmed associations
retain the canonical tracker path plus number/company/role/report, so a renumbered
or replaced row must be matched again. Changing account aliases keeps separate
message identities and cursors. A UIDVALIDITY reset starts a new IMAP identity
set; the old cached records are preserved.

## Interactive JSON interface

Run `node mail.mjs --request < request.json`. Requests and responses are JSON.
The web uses this same core, with no separate mailbox or sending implementation.

```json
{"action":"accounts"}
{"action":"sync","account":"personal","mailbox":"INBOX","since":"2026-10-01","limit":50,"maxPages":2}
{"action":"messages","account":"personal"}
{"action":"match","messageId":"imap-CACHED_MESSAGE_HASH","appNum":42}
{"action":"reply","messageId":"imap-CACHED_MESSAGE_HASH","replyAll":false}
{"action":"prepare","account":"personal","messageId":"imap-CACHED_MESSAGE_HASH","appNum":42,"logFollowup":true,"draft":{"to":["recruiter@example.com"],"subject":"Re: Application","body":"Reviewed reply text","attachments":[]}}
{"action":"fetch","account":"personal","mailbox":"INBOX","since":"2026-10-01","limit":20}
{"action":"import","id":"BATCH_UUID","ids":["imap-MESSAGE_HASH"]}
{"action":"lead","id":"BATCH_UUID","messageId":"imap-MESSAGE_HASH","url":"https://example.com/jobs/123"}
{"action":"prepare","account":"personal","draft":{"to":["recruiter@example.com"],"cc":[],"bcc":[],"subject":"Application","body":"Reviewed email text","attachments":[]}}
{"action":"history"}
{"action":"review","id":"PREPARED_UUID"}
{"action":"send","id":"PREPARED_UUID","confirm":"REVIEWED_SHA256_DIGEST"}
{"action":"reconcile","id":"PREPARED_UUID"}
```

Submit one object per invocation. `sync` accepts 1–50 messages per page and
1–100 pages per invocation (default 50 and 10). The web requests at most two
pages at a time; use another sync to continue. First sync defaults to the previous
30 days in the CLI; the web date field starts at seven days. `messages` may filter
by `account` and/or `appNum`. `match` with `appNum: null` removes a binding.
`reply` only proposes a draft; it never sends or logs. `prepare` can omit
`messageId` for a new email. Linked drafts default to follow-up logging; pass
`logFollowup: false` for correspondence that should not advance the cadence.

Attachments use
`{"name":"cv.pdf","dataBase64":"BASE64_FILE_BYTES"}`. The web reads only files
you select in its file picker. Maximum: 10 attachments, 10 MB total; body 100,000
characters. From is fixed by the chosen account. To/Cc/Bcc accept plain ASCII addresses,
not display-name syntax. Bcc recipients are included in the SMTP envelope but not
in message headers. Preview all recipients and content before authorizing Send.

## One-off fetching and reply-watch imports

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
Receipts survive page reloads: use **Load saved emails** in the web app or `history` and `review` in the CLI. Accepted messages are also recorded locally for conversation matching; a local record is not an IMAP Sent-folder copy. Neither sending nor
importing marks an application Applied, and no sent-folder copy is appended over
IMAP. Provider-side sent copies vary. No delivery/read receipt is claimed.

`config/mail.json` and `data/mail/` are user data. Snapshots include private message
bodies and attachments; they remain locally until you deliberately archive or
remove them. New files use mode 0600. Never commit snapshots or credentials.

Protocol implementation uses Python's standard-library
[imaplib](https://docs.python.org/3/library/imaplib.html),
[smtplib](https://docs.python.org/3/library/smtplib.html), and
[email](https://docs.python.org/3/library/email.html).
