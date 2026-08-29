# Running GoodFolder yourself

Everything GoodFolder needs is in `docker-compose.yml`. You need Docker and
nothing else: no cloud account, no email provider, no AI key.

```bash
cp .env.example .env          # fill in the four CHANGE_ME secrets
docker compose up -d --build  # first build takes a few minutes
```

Then point the command-line tool at your own server:

```bash
export GF_API_URL=http://localhost:4100
goodfolder connect ~/some-folder
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

Two one-shot containers run on first start and then exit: one creates the
storage bucket, the other creates the service account the control plane signs
in as. Both are safe to re-run.

## Signing in without an email provider

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

## Putting it on the internet

The compose file binds every published port to `127.0.0.1`, so nothing is
reachable from outside the machine as it stands. To host it for real, put a
reverse proxy with TLS in front, then set:

- `PUBLIC_URL` to the address people reach the control plane on
- `PUBLIC_LFS_ORIGIN` and `PRESIGN_PUBLIC_ENDPOINT` to the addresses clients
  should upload to
- `WEB_ORIGINS` to the origin your dashboard is served from

Leave `MAGIC_LINK_DEBUG` unset on anything reachable from outside: it returns
sign-in links in the API response.

## Known limitation

Large files are meant to route to object storage rather than into the folder's
history. That routing currently runs after files are staged, so a file added
and saved in the same step goes into the history instead. It is tracked and
does not lose data, but a folder of large files will grow faster than it
should.
