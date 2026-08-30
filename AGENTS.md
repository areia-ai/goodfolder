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
packages/shared     domain types, the routing rule, the case-collision finder
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
10. A folder inside the folder that carries its own separate history has its
    files taken as ordinary files. The engine's default is a bookmark, which
    saves nothing and restores an empty folder. Those paths go through
    routing and the case gate exactly like any other, and the other tool's
    own history is never touched.

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
node --experimental-transform-types --test apps/web/lib/webmcp.test.ts
```

Run the ones near what you changed (`apps/control-plane/src/*.test.ts`,
`apps/web/lib/*.test.ts`, `apps/cli/src/undo.test.ts`, and
`apps/cli/src/{skip,nested}.test.ts`, which build real folders in a temporary
directory and clean up after themselves). CI runs the webmcp one.
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

Hold off for now. There is no contributor licence agreement yet, and merging
outside code without one would permanently rule out ever dual-licensing
GoodFolder, because the project would no longer hold the rights to all of its
own code. `CONTRIBUTING.md` has the detail. Bugs go in issues, direction and
questions go in Discussions, and anything that could be used against a running
instance goes to the address in `SECURITY.md` rather than a public issue.

## Before you hand work back

Run `pnpm gate` and the tests for what you touched. Check `git status` and
commit only the files you meant to. Push only if you were asked to.
