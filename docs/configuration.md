# Configuration

`.env` beside `docker-compose.yml` — copied from `.env.example` — is the only
place a self-hosted install is configured. The same names work as plain
environment variables for a non-Docker deployment.

"Read by" below names which service reads the variable: `api` (the control
plane, port 4100), `lfs` (the large-file service, port 4101), or `web-build`
(the dashboard, baked in when its image is built). Variables marked `compose`
are consumed by docker-compose.yml itself or by the infrastructure services
it runs.

## Secrets you must set

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `GOODFOLDER_DB_PASSWORD` | — | Always | compose (Postgres, `api`, `lfs`) |
| `GITEA_DB_PASSWORD` | — | Always | compose (Gitea's own database) |
| `GITEA_SECRET_KEY` | — | Always | compose (Gitea) |
| `GITEA_ADMIN_PASSWORD` | — | Always | `api`, `lfs` |

## Where this server lives

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `PUBLIC_URL` | `https://api.trygoodfolder.com` | Always (the address sign-in links are built from) | `api` |
| `WEB_URL` | `https://trygoodfolder.com` | When the dashboard is not on trygoodfolder.com | `api` |
| `GOODFOLDER_VERSION` | `latest` | Pinning a release tag such as `0.1.0` | compose |
| `WEB_ORIGINS` | localhost always allowed | Dashboard served from a domain | `api` |
| `WEB_PREVIEW_PROJECTS` | — | Hosted preview deployments on `*.pages.dev` | `api` |

## Ports

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `PORT` | 4100 | Changing the control-plane port | `api` |

## Large files

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `LFS_INTERNAL_URL` | `http://goodfolder-lfs:4101` | Always in Docker | `api` |
| `PUBLIC_LFS_ORIGIN` | `http://localhost:4101` | Always | `lfs` |
| `PRESIGN` | `1` | Set empty to stream through the server instead | `lfs` |
| `PRESIGN_PUBLIC_ENDPOINT` | — | Presigning behind a private network name or a domain | `lfs` |

## Object storage

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `S3_ENDPOINT` | `http://goodfolder-minio:9000` | Always | `api`, `lfs` |
| `S3_REGION` | `auto` | S3 providers that need a real region | `api`, `lfs` |
| `S3_ACCESS_KEY_ID` | — | Always (MinIO reads it as its root credential) | `api`, `lfs`, compose |
| `S3_SECRET_ACCESS_KEY` | — | Always (same) | `api`, `lfs`, compose |
| `S3_BUCKET` | `goodfolder` | Always | `api`, `lfs`, compose |

## Gitea (internal transport, never exposed)

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `GITEA_INTERNAL_URL` | `http://goodfolder-gitea:3000` | Always in Docker | `api`, `lfs` |
| `GITEA_ADMIN_USER` | `gf-service` | Always | `api`, `lfs` |

## Sign-in email

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | — | Sending sign-in email; empty writes links to the log | `api` |
| `MAIL_FROM` | `GoodFolder <auth@trygoodfolder.com>` | With `RESEND_API_KEY` | `api` |
| `MAIL_REPLY_TO` | `contact@trygoodfolder.com` | With `RESEND_API_KEY` | `api` |
| `MAGIC_LINK_DEBUG` | — | Local convenience only — never on a reachable host | `api` |

## AI save labels

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | — | AI-written save labels; empty falls back to a summary | `api` |
| `LABEL_MODEL` | — | Choosing the model | `api` |

## Development routes

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `DEV_API_KEY` | — | Reserved for `/api/dev/*` — no code reads it today | none |

## Hosted billing

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `BILLING_MODE` | `disabled` | `stripe` on the hosted service only | `api`, `lfs` |
| `BILLING_ENFORCEMENT` | `observe` | With `BILLING_MODE=stripe` | `api`, `lfs` |

## WebMCP challenge access

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `CHALLENGE_ACCESS_CODE` | — | A short hosted campaign; all three together | `api`, `lfs` |
| `CHALLENGE_ACCESS_EXPIRES_AT` | — | Same | `api`, `lfs` |
| `CHALLENGE_ACCESS_STAFF_EMAILS` | — | Same | `api`, `lfs` |

## Web client analytics

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | — | Analytics on; empty means off | `web-build` |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://eu.i.posthog.com` | With the key | `web-build` |

The dashboard's API address is also a build-time value: the NEXT_PUBLIC_API_URL
build arg of `apps/web/Dockerfile` (default `http://localhost:4100`), not a
server environment variable.

## Stripe (only when `BILLING_MODE=stripe`)

| Variable | Default | Required when | Read by |
| --- | --- | --- | --- |
| `STRIPE_API_KEY` | — | `BILLING_MODE=stripe` | `api`, `lfs` |
| `STRIPE_WEBHOOK_SECRET` | — | Same | `api`, `lfs` |
| `STRIPE_METER_EVENT_NAME` | — | Same | `api`, `lfs` |
| `STRIPE_CHECKOUT_SUCCESS_URL` | `https://trygoodfolder.com/dashboard?billing=complete` | Same | `api`, `lfs` |
| `STRIPE_PORTAL_RETURN_URL` | `https://trygoodfolder.com/dashboard` | Same | `api`, `lfs` |
| `STRIPE_PRICE_STARTER_MONTH` | — | Same | `api`, `lfs` |
| `STRIPE_PRICE_STARTER_YEAR` | — | Same | `api`, `lfs` |
| `STRIPE_OVERAGE_PRICE_STARTER` | — | Same | `api`, `lfs` |
| `STRIPE_PRICE_PLUS_MONTH` | — | Same | `api`, `lfs` |
| `STRIPE_PRICE_PLUS_YEAR` | — | Same | `api`, `lfs` |
| `STRIPE_OVERAGE_PRICE_PLUS` | — | Same | `api`, `lfs` |
| `STRIPE_PRICE_STUDIO_MONTH` | — | Same | `api`, `lfs` |
| `STRIPE_PRICE_STUDIO_YEAR` | — | Same | `api`, `lfs` |
| `STRIPE_OVERAGE_PRICE_STUDIO` | — | Same | `api`, `lfs` |
| `STRIPE_API_BASE` | `https://api.stripe.com` | Stripe test mode | `api`, `lfs` |
