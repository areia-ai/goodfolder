---
title: Connect a service or cloud assistant
description: Give a hosted assistant or another service its own revocable access to your folders, and hear back when something changes.
order: 45
---

# Connect a service or cloud assistant

GoodFolder is a normal folder with a history you can read. A service or a
hosted assistant can work with that history from somewhere else — a cloud
runner, a chat assistant, an automation you wrote — without being handed your
whole account.

## What a service can be allowed to do

Access comes in five kinds, chosen one by one when you approve a service:

| | |
| --- | --- |
| `read:folders` | See folders and their history |
| `read:files` | Read files |
| `write:proposals` | Prepare change proposals and comments |
| `git:read` | Copy a folder's contents to another computer |
| `git:write` | Send changed files back to the folder |

A service key can be limited to one folder, or to every folder on the
account. It can never change billing, invite people, create or delete
folders, or reach another account. Every request it makes is written to the
account's activity record under the key's name, and you can take a key back
at any moment.

## Approve a service

From the dashboard, open your account menu and choose **Services and
assistants**. Name the service, tick the access it needs, choose one folder or
all of them, and GoodFolder shows the key once. Copy it then — it is never
shown again.

A service that supports the approval ceremony can also ask for access itself:
it starts a request, shows you a short code and a link, and you approve it
while signed in. Either way the same key is created, and either way you can
take it back from the dashboard.

## The two ways a service talks to GoodFolder

- **Tools.** A hosted assistant connects to the same tool surface the local
  agent server offers, over HTTP at `/mcp`, using its key. The tools are the
  familiar ones: `goodfolder_create`, `goodfolder_clone`,
  `goodfolder_connect`, `goodfolder_rename`, `goodfolder_save`,
  `goodfolder_sync`, `goodfolder_log`, `goodfolder_restore`,
  `goodfolder_undo`.
- **Plain HTTP.** Everything the tools do is also an ordinary HTTP call. The
  whole surface is described in one document at `/openapi.json`, which anyone
  can read without an account.

Both surfaces answer from the same history and obey the same access kinds.
A return to an earlier save is always recorded as a new save — nothing a
service does rewrites what already happened.

## Hear about changes

Add an **Event destination** in the dashboard — an address that should hear
about saves and change proposals. GoodFolder sends a signed message to it,
retries on a schedule if the address does not answer, and keeps every attempt
where you can see it. The signing secret is shown once, when the destination
is created.

Events: `save.created`, `proposal.created`, `proposal.reviewed`, and
`save.requested` (reserved for a future release).

Every message carries a signature over its timestamp and body, so the
receiving service can prove the message came from GoodFolder and was not
replayed. The example below checks one:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function signatureIsValid(secret, timestamp, body, header) {
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

## Self-hosting

Nothing here needs a cloud account: a self-hosted install serves the same
document, the same tools, and the same events at its own address. The command
line and the example read `GF_API_URL`; the server names itself with
`PUBLIC_URL`.

For the exact request and response shapes — including the address a cloud
runner uses to download a folder and send changes back — see the
[service integration reference](../docs/service-protocol.md) on GitHub, and
the runnable example at
[examples/service-assistant.mjs](../examples/service-assistant.mjs).
