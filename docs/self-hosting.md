---
title: Self-hosting
description: Run the whole GoodFolder stack with Docker — no cloud account, email provider, or AI key.
order: 50
---

# Running GoodFolder yourself

Everything GoodFolder needs is in `docker-compose.yml`. You need Docker and
nothing else: no cloud account, no email provider, no AI key.

```bash
cp .env.example .env    # replace every CHANGE_ME value
docker compose up -d    # downloads the prebuilt images
```

Or build from the source you have: `docker compose up -d --build` (the first
build takes a few minutes).

Then open http://localhost:4300 — the dashboard is part of the stack.

## Command-line tool

Install the `goodfolder` command (Node 22 or newer):

```bash
npm install -g @goodfolder/cli
GF_API_URL=http://localhost:4100 goodfolder connect ~/some-folder
```

A folder remembers the server it was set up against, so you only need that
variable when setting up a new one.

## What comes up

| Service | Purpose |
| --- | --- |
| `goodfolder-postgres` | Accounts, folders, saves. The schema is applied on first start. |
| `goodfolder-minio` | Object storage for large files. Published on 9100 because uploads go straight from your machine to storage. |
| `goodfolder-gitea` | Internal transport only. Never published, no SSH, registration off. |
| `goodfolder-api` | The control plane, on 4100. |
| `goodfolder-lfs` | Large-file transfers, on 4101. |
| `goodfolder-web` | The dashboard, on 4300. Built for the `PUBLIC_URL` in your .env. |

Three one-shot containers run and then exit: one creates the storage bucket,
one creates the service account the control plane signs in as, and one
(`goodfolder-migrate`) brings the database schema up to the version of the
release you are running. All are safe to re-run; the schema one runs on every
`up` and does nothing when there is nothing new.

## If a port is already taken

Compose reads `docker-compose.override.yml` next to the main file
automatically, so that is where a port move lives. To shift MinIO — the port
most likely to clash, since uploads go straight to it:

```yaml
services:
  goodfolder-minio:
    ports: !override
      - "127.0.0.1:9299:9000"
```

`!override` matters: without it Compose appends to the port list instead of
replacing it, and the old 9100 mapping stays. Set `PRESIGN_PUBLIC_ENDPOINT` in
`.env` to match (`http://localhost:9299`) so signed upload addresses point at
the new port. The same file is where the Traefik labels in
[the reverse-proxy guide](reverse-proxy.md) go. It is per-machine, so it is ignored.

## Signing in without an email provider

Open the dashboard at http://localhost:4300 and enter your email address.
Leave `RESEND_API_KEY` empty and the one-time sign-in link is written to the
server log instead of being emailed:

```bash
docker compose logs goodfolder-api | grep magic-link
```

Open that link in a browser. For a single operator this is a perfectly good
setup. Set `RESEND_API_KEY` when you want other people to be able to sign in.

## Save labels without an AI key

Leave `OPENROUTER_API_KEY` empty. Saves still work; they get a plain generated
summary instead of a written one. A label can never block a save.

## The save gate

The control plane checks every push before the transport service sees it
and refuses — as a whole — any save that adds files the folder's rules keep
out. Two variables tune it:

- `GF_PUSH_GATE`: `enforce` (default) refuses; `observe` forwards but logs
  and audits what it would have refused; `off` restores plain streaming.
- `GF_PUSH_MAX_BYTES`: the largest push body checked in one go (default
  2 GiB). Bigger saves get a `too-large` answer before anything
  upstream is touched; saving in parts is the workaround.

The check spools each push to a temporary file under the API container's
`/tmp` first, so that filesystem needs free space up to
`GF_PUSH_MAX_BYTES` per concurrent push (at most four are checked at a
time; the rest wait). Spool files are always removed when a push finishes
or is refused, and any left behind are swept at startup.

One boundary matters: the gate — and the post-push check that raises
`save.flagged` — only cover traffic that passes through the control plane.
Publishing Gitea's port, enabling its SSH access, or pointing a client
straight at Gitea bypasses both. The compose file publishes nothing for
Gitea and enables no SSH; keep it that way.

## Putting it on the internet

The compose file binds every published port to `127.0.0.1`, so nothing is
reachable from outside the machine as it stands. To host it for real, put a
reverse proxy with TLS in front, then set:

- `PUBLIC_URL` to the address people reach the control plane on
- `WEB_URL` to the address people open the dashboard on — invitation and
  review links are built from it
- `PUBLIC_LFS_ORIGIN` and `PRESIGN_PUBLIC_ENDPOINT` to the addresses clients
  should upload to
- `WEB_ORIGINS` to the origin your dashboard is served from

The dashboard's API address is baked in when `goodfolder-web` is built, so
changing `PUBLIC_URL` means rebuilding it:

```bash
docker compose up -d --build goodfolder-web
```

Leave `MAGIC_LINK_DEBUG` unset on anything reachable from outside: it returns
sign-in links in the API response.

## Upgrading

Get the release you want, then either set `GOODFOLDER_VERSION` in `.env` to
its tag (for example `GOODFOLDER_VERSION=0.2.0`) and pull the images:

```bash
docker compose pull
docker compose up -d
```

or build from the new source with `docker compose up -d --build`.

Either way, the schema upgrade runs by itself before the services start —
`goodfolder-migrate` applies any files in `infra/migrations/` the database
has not seen yet, in file-name order. Watch it with:

```bash
docker compose logs goodfolder-migrate
```

"schema up to date" means there was nothing to do.

If your install predates tracked upgrades (2026-09-13), the runner cannot
tell which old files already ran, so it records them all as applied. Apply
the ones dated after your install by hand first — the files are mounted into
the database container:

```bash
docker compose exec goodfolder-postgres \
  psql -U goodfolder -d goodfolder -f /goodfolder-migrations/2026-XX-XX-name.sql
docker compose exec goodfolder-postgres psql -U goodfolder -d goodfolder \
  -c "INSERT INTO schema_migrations (name) VALUES ('2026-XX-XX-name.sql')"
```

## Backing up

Everything the stack writes lives under `./data/` — Postgres, MinIO, and the
transport store — plus your `.env`, which holds the secrets. Copy those and
you have the whole install.

For a consistent database copy without stopping anything:

```bash
docker compose exec goodfolder-postgres pg_dump -U goodfolder goodfolder > backup.sql
```

Or stop the stack (`docker compose stop`) and copy `./data/` at rest.

## Large files

Anything over 1 MB goes to object storage rather than into the folder's
history, and the history keeps a small pointer to it. Nothing extra to
configure; MinIO handles it.

One caveat if you have been running GoodFolder since before this worked:
large files saved by an older version went into the history as whole copies,
and they stay that way until the file is next modified. New saves route
correctly.
