# GoodFolder for the OpenAI WebMCP Challenge

GoodFolder gives an ordinary folder readable history: Save, Timeline, and
Restore. It existed before this challenge. This document separates that work
from the WebMCP work added during the submission period.

## What changed for this challenge

WebMCP support began in [`516a4fb`](https://github.com/areia-ai/goodfolder/commit/516a4fb)
on August 26, 2026, with five read-only dashboard tools. The dashboard then
grew into a nineteen-tool human-and-agent workspace:

- [`5ceea29`](https://github.com/areia-ai/goodfolder/commit/5ceea29) added
  reviewable Change Proposals.
- [`9082e79`](https://github.com/areia-ai/goodfolder/commit/9082e79) let an
  agent propose source-file edits while keeping acceptance with the person.
- [`88704f2`](https://github.com/areia-ai/goodfolder/commit/88704f2) added
  media proposals that wait outside the folder until a person reviews them.
- [`d10ec13`](https://github.com/areia-ai/goodfolder/commit/d10ec13) added a
  checked-in site-tool schema and deterministic evaluation suite.

The current tool set lives in
[`apps/web/lib/webmcp.ts`](apps/web/lib/webmcp.ts). It registers with
`navigator.modelContext` when a browser supports WebMCP. Fourteen tools read
the workspace, its files, history, and proposals. Five tools create a Change
Proposal or a comment for review. The tools do not expose acceptance, direct
save, restore, invitation, deletion, or access-control actions.

That split is the point of the project. An agent can answer questions such as
“what changed in the brief?”, inspect a CSV range, find the last Save that
touched a file, or prepare a small correction. The folder owner keeps the
moment that changes the folder. In the normal dashboard, they can inspect a
proposal and decide whether to accept it.

## Running the project

The project is open source under the [AGPL-3.0 license](LICENSE). For a local
stack, copy `.env.example` to a private `.env`, set its required local values,
then run:

```sh
docker compose up -d --build
```

`SELF_HOSTING.md` contains the complete local setup. The app uses local
Postgres, MinIO, and Gitea in that setup, so it does not require a cloud,
email, billing, or model account to run.

## Judge access

The live submission URL is `https://trygoodfolder.com/dashboard`.

During judging, use the email sign-in screen to create or enter an account.
Then open the account menu in the lower-left corner of the dashboard and choose
**Redeem challenge code**. The code will appear only in the Devpost testing
instructions, not in this repository or the video.

The code grants full hosted access, including folder creation and invitations,
until October 1, 2026 at 00:00 Europe/Lisbon. It is free for judges. After that
point, accounts stay available in read-and-export mode; nothing is deleted.

To test WebMCP, open the signed-in dashboard in ChatGPT’s in-app browser, or
in Chrome with WebMCP testing enabled. The page registers its Site tools only
when the dashboard has an authenticated account.

## Checks kept in the repository

After a WebMCP tool changes, this repository checks that the checked-in schema
matches the registered tools and that the evaluation cases name only real,
permitted tools:

```sh
pnpm webmcp:schema
node --experimental-transform-types --test \
  apps/web/lib/webmcp.test.ts apps/web/lib/webmcp.evals.test.ts
```

`pnpm gate` also checks every workspace typecheck and prevents internal engine
terms from appearing in product-facing copy.
