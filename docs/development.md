---
title: Working on GoodFolder
description: The contributor loop — running the services and tests from source.
order: 80
site: false
---

# Working on GoodFolder

The loop for changing the code itself. To *run* GoodFolder rather than work on
it, see [the self-hosting guide](self-hosting.md).

## What you need

- Node 22 or newer
- pnpm 11 (`corepack enable` gives you the pinned version)
- Docker, for the infrastructure the services talk to

## First setup

```bash
pnpm install
```

Start only the infrastructure — Postgres, MinIO, Gitea, and the one-shot
setup jobs — with the development override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d \
  goodfolder-postgres goodfolder-minio goodfolder-minio-setup \
  goodfolder-gitea goodfolder-gitea-setup goodfolder-migrate
```

This publishes Postgres on `127.0.0.1:5432` and Gitea on `127.0.0.1:3000`
(loopback only) so processes on your machine can reach them.

Copy the dev environment files and fill in the `CHANGE_ME` values — the same
passwords you put in the stack's `.env`:

```bash
cp apps/control-plane/.env.dev.example apps/control-plane/.env.dev
cp apps/lfs/.env.dev.example apps/lfs/.env.dev
```

Then run all three services from source:

```bash
pnpm dev
```

The dashboard is the Next dev server on http://localhost:4300. To point it at
your local API, create `apps/web/.env.local` with:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4100
```

(That file is already ignored; it is how `next dev` picks up `NEXT_PUBLIC_*`
values.)

With `MAGIC_LINK_DEBUG=1` in the control plane's `.env.dev`, the sign-in link
comes back in the API response, so no email provider is needed locally.

## The command-line tool from source

```bash
GF_API_URL=http://localhost:4100 pnpm --filter @goodfolder/cli dev -- connect ~/some-folder
```

Same for any other command: `dev --` followed by what you would pass to
`goodfolder`.

## Checks

```bash
pnpm gate       # typecheck every workspace, then the vocabulary gate
pnpm test       # every workspace's tests
node tools/validate-brand.mjs
node tools/check-contrast.mjs
pnpm env:docs   # docs/configuration.md must match .env.example
```

Tests live beside the code: `apps/control-plane/src/*.test.ts`,
`apps/web/lib/*.test.ts`, `apps/cli/src/*.test.ts`, `packages/*/src`. They run
with the plain Node test runner — no extra services needed.

After changing `apps/web/lib/webmcp.ts`, run `pnpm webmcp:schema` and include
the regenerated `webmcp.schema.json` — a test fails when it drifts. After
changing `.env.example`, `pnpm env:docs` fails until `docs/configuration.md`
names the same variables.

The dashboard's service surface has its own browser check, run by the
`services-e2e` workflow and not by `pnpm test`:
`E2E_POSTGRES_URL=postgres://user:pass@127.0.0.1:5432/postgres pnpm --filter @goodfolder/web e2e:services`
(needs a Postgres that allows `CREATE DATABASE`, and Chromium via
`pnpm --filter @goodfolder/web exec playwright install chromium`).
`E2E_KEEP=1` keeps the scratch database and skips the drop,
`E2E_DATABASE_URL` uses a database you already have instead of creating one,
and `E2E_SKIP_WEB_BUILD=1` reuses an existing `apps/web/out`.

Two rules to know before writing copy: user-facing text can never use
version-control vocabulary (`pnpm vocab` enforces it), and migrations under
`infra/migrations/` are applied to self-hosted installs in file-name order —
name by date, and make each one safe to run exactly once.
