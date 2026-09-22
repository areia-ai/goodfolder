---
title: Service integration reference
description: The raw protocol third-party services and hosted assistants use.
order: 85
site: false
---

# Service integration reference

Not rendered on the site: this page names the engine on purpose, for people
building an integration. The product surfaces — labels, screens, errors, CLI
output — never do. `AGENTS.md` rule 10 keeps that boundary; this file is on
the engineering side of it, alongside `docs/development.md`.

Everything below is served by any GoodFolder install, hosted or self-hosted.
The server names itself with `PUBLIC_URL`; clients read `GF_API_URL` (the CLI
and the example script do). There is no separate surface for the hosted
service.

## 1. Credentials

Two credentials exist:

- **Account approval** (`gfa_…`) — what the browser pairing ceremony mints
  for a computer. Full account access. Not for third parties.
- **Scoped service key** (`gfx_…`) — what a service gets. It carries a subset
  of the scopes below and is optionally bound to exactly one folder.

Scopes: `read:folders`, `read:files`, `write:proposals`, `git:read`,
`git:write`. A key never reaches billing, invitations, folder creation or
deletion, account settings, or another account.

### Getting a key: device authorization

```
POST /api/pair/start
{ "deviceName": "Instinct", "scopes": ["read:folders", "git:write"], "projectId": "<uuid, optional>" }
→ { "code": "<32 hex>", "url": "https://…/pair/<code>" }

GET  /api/pair/{code}/wait        (poll; the code is the bearer)
→ { "status": "pending" | "approved" | "denied" | "consumed" | "expired" }
→ { "status": "approved", "token": "gfx_…" }   (exactly once)
```

A person opens `url`, signs in by one-time link, sees the requested scopes
and the folder they apply to, and approves. Omit `scopes` to request an
account approval instead (existing behaviour, unchanged).

### Getting a key: dashboard

`POST /api/service-credentials` with an account credential or browser
session: `{ "name", "scopes", "projectId"? }` → `{ "id", "token" }`. The key
is returned once. `GET /api/service-credentials` lists keys;
`DELETE /api/service-credentials/{id}` revokes one;
`GET /api/service-credentials/{id}/usage` returns the audit trail of what it
did.

### Using a key

`Authorization: Bearer gfx_…` on every REST call, and on the MCP endpoint.
Git clients send it as Basic auth (any username, the key as the password):
`https://x:gfx_…@api.trygoodfolder.com/git/<projectId>`.

## 2. Remote git access

The transport is the same proxy the folder clients use:

```
/git/<projectId>/info/refs?service=git-upload-pack      requires git:read
/git/<projectId>/info/refs?service=git-receive-pack     requires git:write
/git/<projectId>/git-upload-pack                        requires git:read
/git/<projectId>/git-receive-pack                       requires git:write
```

Nothing else under `/git/*` is forwarded. Large files (the LFS path) work
transparently over the same credential; the batch endpoint resolves the key
against the folder and checks the matching scope per direction. Presigned
uploads go straight to object storage.

After a push lands, record the save:

```
POST /api/saves
{ "projectId": "<uuid>", "label": "Added the pricing section", "harness": "Instinct" }
→ { "seq": 42, "label": "…", "counts": { "added": 1, "changed": 2, "removed": 0 } }
```

The receipt (changed paths, counts) is computed from the folder's own tree
between the last recorded save and the current state — the caller sends no
file list, and a stale `commitSha` (optional) is refused rather than
recorded. `harness` names the assistant on the timeline.

### Reading a save result: `warnings`, `flagged`, `skipped`

Every recorded save answers with three lists. They describe different
things, and none of them is a scan of the folder.

**The two tiers.** The rules are data in `packages/shared` and match on
names only. File contents are never read.

- **Skip tier**: names shaped like credentials, such as `.env`, `.env.*`,
  `*.pem`, `id_rsa`, `id_ed25519`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`
  and a file named exactly `credentials`. Paths on the folder's
  `.goodfolderignore` get the same treatment. These are kept out. A folder
  client leaves them out before pushing, and the browser refuses to add
  them. If one arrives anyway, it is saved and `flagged`, not warned.
- **Warn tier**: file names containing `secret`, `password` or
  `credential` (case-insensitive), or shaped like `*.key.*`. These are
  saved. A warning never blocks a save. Plain `*.key` is neither tier,
  because it is a Keynote deck.

**`warnings`: `[{ path, pattern, change }]`**. The server computes these
from the folder's own tree, comparing the last recorded save with this
one. It does not take the caller's word for them.

- Only files this save **added or changed** are evaluated.
  `change` is `added` or `changed`. It is absent on saves recorded before
  the field existed.
- Removed files are not evaluated, and neither are files this save did not
  touch. A secret-named file saved last week does not warn again until it
  changes.
- If the trees can't be read, the save is still recorded, with no warnings.

**What an empty `warnings` array means.** Only that nothing this save
added or changed has a warn-tier name. It does **not** mean:

- the folder holds no secrets, since files the save didn't touch aren't
  evaluated;
- no file contains a secret, since contents are never read;
- no credential-shaped file arrived, since those appear in `flagged`, not
  here;
- the device left nothing out, which is what `skipped` reports.

To judge the whole folder, read its files and history. No save result can
tell you that.

**`flagged`: `[{ path, pattern, kind, deliberate }]`**. Files this save
**added** that the skip tier (`kind: "credentials"`) or the folder's
`.goodfolderignore` (`kind: "ignored"`) should have kept out. It appears in
the `POST /api/saves` response only; timeline reads do not return it. The
durable record is the audit log and the `save.flagged` webhook (section 5),
and that webhook also fires for pushes that are never recorded as saves.
Changed files are not flagged again: an already-saved `.env` that changes
appears in neither list. The bytes have landed either way. Flagging
reports that; it doesn't prevent it.

**`skipped`: `[{ path, source, category?, pattern, reason }]`**, with
`skippedTotal` and `skippedReportedBy`. These are the files the **device**
left out of this save, and the rule that left each one out:

- `source: "built-in"`: `pattern` is the built-in rule and `category` its
  group (`credentials`, `installed`, `rebuildable` or `noise`).
- `source: "ignore-list"`: `pattern` is the `.goodfolderignore` line.
- `source: "their-own"`: the project's own settings on that computer.

The server never receives skipped files, so this list is what the device
reported, stored as it was sent and not verified. A folder the device left
out whole is one entry, and its path ends in `/`. The list is capped at
200 entries, and `skippedTotal` is the full count.
`skippedReportedBy` is `"device"` when the save carried a report. It is
`null` for browser saves, services that didn't report, and older
devices. In that case `skipped` is `[]` and tells you nothing either way.
An empty list only means "nothing was left out" when `skippedReportedBy`
is `"device"`.

**Which rules apply to a folder.** `GET /api/projects/{id}/exclusions`
(read:folders), or `GET /api/exclusions` with a folder credential,
returns:

- the built-in skip rules, with the evidence each one needs, if any;
- the warn-tier patterns;
- the folder's `.goodfolderignore` as the server reads it at the latest
  state: valid `patterns` plus each `invalid` line and why it's invalid.

`at` names the state it was read from, and is `null` before the first
save. Settings that exist only on a device can't be seen from here.

Scoped keys cannot mint folder transfer tokens
(`POST /api/folder-token/renew` requires a folder credential), and a key
bound to one folder is refused on every other folder's routes and transport
paths.

## 3. REST surface

The authoritative description is served at `GET /openapi.json` (OpenAPI 3.1,
no credential required). Highlights:

| Route | Scope |
| --- | --- |
| `GET /api/projects` | read:folders (folder-bound keys see only their folder) |
| `GET /api/projects/{id}/saves` | read:folders |
| `GET /api/projects/{id}/exclusions` | read:folders |
| `GET /api/projects/{id}/files`, `/file`, `/file/raw` | read:files |
| `GET /api/projects/{id}/proposals` | read:folders |
| `POST /api/projects/{id}/proposals` | write:proposals |
| `POST /api/projects/{id}/proposals/{pid}/comments` | write:proposals |
| `POST /api/projects/{id}/document/comments` | write:proposals |
| `POST /api/projects/{id}/staged-files` | write:proposals (bytes waiting for review) |
| `POST /api/projects/{id}/restore` | git:read to preview, git:write to act |
| `POST /api/projects/{id}/undo` | git:read to preview, git:write to act |
| `POST /api/saves` | git:write |
| `GET /api/webhooks` … | account credential only |
| `POST /mcp` | the tool's own scope |

Restore and undo are revert-style by design: they write a NEW save that
matches the older state and never rewrite history. There is no force-restore
that bypasses a device holding the folder. `confirm: false` (or omitted)
previews the exact file list first.

## 4. Hosted MCP endpoint

```
POST /mcp
Authorization: Bearer gfx_…
Content-Type: application/json
Accept: application/json, text/event-stream
```

MCP Streamable HTTP, stateless mode: one request, one JSON-RPC message
(`initialize`, `tools/list`, `tools/call`). The nine tools are the same names
and argument shapes as the local `goodfolder-mcp` server. Scope per tool:
create/rename require an account approval; clone/connect/log require
read:folders; save/restore/undo require git:write (previews need git:read);
sync requires git:read. Tool results are the same plain-language text the
local server returns, adapted for a caller with no local folder.

## 5. Webhooks

Events: `save.created`, `save.flagged`, `proposal.created`,
`proposal.reviewed`, and `save.requested` (reserved; no emitter yet).

`save.flagged` fires when a push lands files the leave-out rules would
normally keep out — a name shaped like a credential, or a path on the
folder's `.goodfolderignore` list. It fires on the push itself, so it also
covers work that is never recorded as a save; when it is, `data.seq` is
`null` and `data.head` names the state the push produced. The rest of
`data` is `flagged`, a list of `{ path, pattern, kind, deliberate }`
entries where `kind` is `credentials` or `ignored` and `deliberate` says
the saver asked for the file on purpose.

```
POST <your address>
X-GoodFolder-Event: save.created
X-GoodFolder-Delivery: <uuid>
X-GoodFolder-Timestamp: 1758000000
X-GoodFolder-Signature: sha256=<hex hmac>
User-Agent: GoodFolder-Webhooks/1.0

{ "event": "save.created", "sentAt": "…", "accountId": "…", "folderId": "…", "data": { … } }
```

The signature is `HMAC-SHA256(secret, "<timestamp>.<raw body>")`, hex, with
the `sha256=` prefix. Compare in constant time and reject old timestamps.

Retries: 5 attempts at 30s, 2m, 10m, 1h, 6h. A destination is disabled by
the person, not automatically. Delivery history is visible at
`GET /api/webhooks/{id}/deliveries`. Redirects are not followed and private
addresses are refused at creation time.

## 6. Self-hosting checklist

- `PUBLIC_URL` must be the public origin: approval links, MCP tool output,
  and the OpenAPI `servers[0].url` are built from it.
- `GF_API_URL` is what the CLI and the example script point at.
- Apply `infra/migrations/2026-09-17-service-access-and-webhooks.sql`,
  `2026-09-22-save-warnings.sql` and `2026-09-23-save-skipped.sql` through
  the normal upgrade path (`infra/selfhost/migrate.sh`).
- No new required environment variables, no external service, no cloud
  account.
