# AGENTS.md — working on GoodFolder

Written for AI agents and the people running them. A human contributor gets the
same picture; read it before you change anything.

## What GoodFolder is

GoodFolder puts readable history, Save, Sync, Timeline and Restore around an
ordinary folder. There is a version-control engine underneath, and that
vocabulary must never reach anyone using the product: no "commit", no "branch",
no "repository" in a label, a screen, an error, or a line the CLI prints.
`pnpm vocab` checks this and CI fails the build when it leaks.

## Where the code lives

```text
apps/cli            the `goodfolder` command
apps/mcp            Model Context Protocol server, so agents drive the same verbs
apps/control-plane  accounts, folders, saves, permissions, the transport proxy
apps/lfs            large-file transfers against S3-compatible storage
apps/web            landing page and dashboard
packages/shared     domain types, the routing rule, the case-collision finder,
                    the rules for what a save leaves out
packages/serverlib  database, credentials, object storage, transport adapter
infra/              schema, migrations, the production compose file
tools/              the gates CI runs: vocabulary, brand SVG, contrast
```

## Rules a change must not break

1. Case-colliding paths — `README.md` and `readme.md` in one folder — must
   never reach a Save. There is a hard gate for this and it exists because some
   filesystems keep both and others silently merge them.
2. Authorisation lives in GoodFolder's own middleware. The transport service
   (Gitea) is given no trust, publishes no ports, and never sees an end-user
   credential.
3. Account routes that a browser session uses sit above the scoped bearer
   middleware. Hono runs handlers in registration order, so a middleware
   registered after the routes never runs for them.
4. A Save label is written by an AI model when a key is configured and falls
   back to a plain summary when it isn't. A slow or failed label must never
   block or delay the Save.
5. Restore writes a new Save. It never rewrites history.
6. Self-hosting works with nothing but Docker — no cloud account, no mail
   provider, no billing provider, no AI key. Any change to the server keeps
   that true.
7. Never commit a real `.env`, a key, or a token.
8. A Save deliberately leaves some things out: downloaded packages, output the
   project's own tools rebuild, operating-system litter, and files shaped like
   credentials. The rules are data in `packages/shared`, and the engine does
   the matching — never re-implement a path matcher, or what a Save omits and
   what GoodFolder says it omitted will drift apart. When adding a rule, the
   principle is **when in doubt, protect**: a wrong skip loses someone's work
   silently, a wrong protect only costs space. Anything whose name could
   belong to a human-made folder (`dist`, `build`, `out`, `target`) needs
   evidence on disk before its rule applies. `*.key` is a Keynote deck, not a
   private key.
9. GoodFolder's transport entry is named `goodfolder`, never the default name.
   A folder holding code usually already points somewhere the person chose,
   and taking that name would silently redirect their existing setup at us.
10. Exactly one file may name the engine in front of a reader:
    `apps/web/components/for-engineers.tsx`, a block near the foot of the
    landing page written for someone evaluating GoodFolder on behalf of
    colleagues who will never read it. Rule 1's wall protects the *product* —
    labels, screens, errors, CLI output — and that block is not the product.
    The vocabulary gate excuses two words in that one file and nothing else;
    a third word, or a second file, is a positioning decision, not an edit.
11. A folder inside the folder that carries its own separate history has its
    files taken as ordinary files. The engine's default is a bookmark, which
    saves nothing and restores an empty folder. Those paths go through
    routing and the case gate exactly like any other, and the other tool's
    own history is never touched.
12. A web page in a folder is rendered, scripts and all, and two things keep
    that from being reckless. The frame it renders in is never given
    `allow-same-origin` — with it, a page in someone's folder would run as the
    dashboard, read its storage and speak to the account API as the person
    signed in. And an `.html` file is never served as `text/html` from the API,
    where the session cookie lives; it stays a text kind, read as JSON through
    the document endpoint, and everything it points at is carried into it as
    `data:` addresses before it is handed over. Both have tests; if one fails,
    change the change.

## Working on it

Node 22 or newer, and pnpm 11 (`package.json` pins the exact version in
`packageManager`).

```bash
pnpm install
pnpm gate     # typecheck every workspace, then the vocabulary gate
```

CI runs two more checks that `pnpm gate` doesn't, worth running when you touch
`apps/web`:

```bash
node tools/validate-brand.mjs
node tools/check-contrast.mjs
```

Tests are plain files run with the Node test runner, not a `test` script:

```bash
node --experimental-transform-types --test apps/web/lib/webmcp.test.ts apps/web/lib/webmcp.evals.test.ts
```

Run the ones near what you changed (`apps/control-plane/src/*.test.ts`,
`apps/web/lib/*.test.ts`, `apps/cli/src/undo.test.ts`, and
`apps/cli/src/{skip,nested}.test.ts`, which build real folders in a temporary
directory and clean up after themselves). CI runs the webmcp ones.

The dashboard's WebMCP tools are also captured as a plain schema for Google's
`webmcp-evals` runner. After changing any tool in `apps/web/lib/webmcp.ts`, run
`pnpm webmcp:schema` and commit `apps/web/lib/webmcp.schema.json` —
`webmcp.evals.test.ts` fails CI when it drifts, and also checks that
`apps/web/lib/webmcp.evals.json` (the tool-selection suite) only names real
tools. To score the suite against a model:

```bash
OPENAI_API_KEY=<openrouter key> OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
  pnpm webmcp:evals -m openai:openai/gpt-4o -r 3
```

`local` mode mocks every tool result, so this measures first-tool routing
(`--max-steps 1`): a capable model that orients with `get_workspace_context`
first will "miss" some read cases, which is fine — the suite is really watching
for wrong-sibling routing and any reach for an accept/save tool. The
`webmcp-evals` workflow runs it weekly and on demand (needs an
`OPENROUTER_API_KEY` secret).
`apps/mcp/flow-test.mts` and `test-mcp.mts` hit a live server and create real
folders and storage rows, so only run them against a server you control, with a
plan to clean up after.

To watch the whole stack run, follow `SELF_HOSTING.md`:
`docker compose up -d --build` brings up Postgres, MinIO, Gitea and both
services on your machine.

## Habits that keep the tree clean

- Stage only what your change touches. Leave an unrelated mess in the worktree
  alone.
- Migrations are additive: add a file under `infra/migrations/` and keep
  `infra/schema.sql` matching it.
- For anything that renders, check the rendered result. Code that compiles is
  not proof the screen is right.
- Keep `README.md` and `SELF_HOSTING.md` true when behaviour changes.
- Commit under your own name and email. `git config user.name` and
  `git config user.email` should be you, whatever the repo you cloned or forked
  from was set to.

## Things not to do on your own

The hosted service runs from this same code, so a careless push travels. Don't
deploy, apply a migration to a production database, publish a package, or run a
destructive cleanup unless the person you are working for asks for it in that
session.

## Pull requests

Open. Before anything is merged you'll be asked to sign a contributor licence
agreement: `ICLA.md` for yourself, `CCLA.md` if you're contributing for an
employer. Opening a pull request triggers a bot that takes the signature as a
comment, so there's no form and no extra account. Signing isn't a promise to
merge; each pull request is still read on its own merits. `CONTRIBUTING.md`
has the reasoning and what the agreement actually says.

Bugs and self-hosting trouble go in issues, which have a form each. Direction,
questions and anything you built go in Discussions. Anything that could be used
against a running instance goes to the address in `SECURITY.md` rather than a
public issue.

## Before you hand work back

Run `pnpm gate` and the tests for what you touched. Check `git status` and
commit only the files you meant to. Push only if you were asked to.
