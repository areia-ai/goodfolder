# AGENTS.md - working on GoodFolder

Read this before changing anything in this repository.

## Repository authority

This repository is the sole source of truth for GoodFolder:

```text
https://github.com/areia-ai/goodfolder
```

Work directly in a checkout whose `origin` points to that URL. Do not inspect,
edit, copy from, commit to, push to, or synchronize another GoodFolder
repository. If the remote does not match, stop before making changes.

Before every working session, run:

```bash
git remote get-url origin
git status --short --branch
git config --get user.name
git config --get user.email
```

The expected author identity is:

```text
Carlos Marcial <carlosmarcialtorres@gmail.com>
```

Set it in this repository's local Git configuration if either value differs.
Do not replace global Git identity settings for this purpose. GitHub must
attribute GoodFolder commits to `carlosmarcial`, never `paradigm-carlos`.

## What GoodFolder is

GoodFolder puts readable history, Save, Sync, Timeline, and Restore around an
ordinary folder. It uses an established version-control engine underneath, but
that vocabulary must not reach people using the product.

## Repository layout

```text
apps/cli            command-line client
apps/mcp            agent tools
apps/control-plane  accounts, folders, saves, permissions, transport proxy
apps/lfs            large-file transfers
apps/web            landing page and dashboard
packages/shared     shared domain rules and types
packages/serverlib  database, credentials, storage, transport adapter
infra/              schema, migrations, containers
```

## Product and security rules

1. Case-colliding paths must never reach a Save.
2. Authorization belongs in GoodFolder middleware; the transport service gets
   no trust and publishes no ports.
3. Browser-session account routes must stay above scoped bearer middleware.
   Hono runs handlers in registration order.
4. A failed AI-written label must fall back and must never block a Save.
5. Keep engine vocabulary out of every user-facing surface.
6. Restore creates a new Save; it never rewrites history.
7. Never commit credentials or `.env` files.
8. Self-hosting must keep working without a cloud account, mail provider,
   billing provider, or AI key.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm vocab
pnpm gate
node --experimental-transform-types --test apps/web/lib/webmcp.test.ts
```

Run tests that match the changed subsystem. Production flow tests create real
folders and storage records, so do not run them without explicit authorization
and a cleanup plan.

## Working rules

- Preserve unrelated changes in a dirty worktree.
- Use additive database migrations and keep `infra/schema.sql` current.
- Check rendered behavior for user-interface work; code presence alone is not
  proof.
- Do not deploy, apply a production migration, publish a package, or perform a
  destructive cleanup without action-time authorization.
- Keep `README.md` and `SELF_HOSTING.md` accurate when behavior changes.

## Local working records

`LOG.md`, `LOCAL_PRICING_DECISIONS.md`, and
`LOCAL_HOSTED_PRICING_ACCESS_PLAN.md` are private working files. Git ignores
them deliberately. Never add them with `--force`, quote their contents in a
public commit, or publish them elsewhere. A fresh clone may not contain them.

When a local `LOG.md` exists, read it for local context and append substantive
decisions, completed work, tests, and remaining work. Do not rewrite earlier
entries. Its absence in a fresh clone is expected and must not block work.

## End of session

Before handing work back:

1. Run the relevant tests and `pnpm gate`.
2. Recheck `origin` and the effective author identity.
3. If a local `LOG.md` exists, append the result, tests, and remaining work.
4. Commit only intended files. Push only when the user authorized it.
