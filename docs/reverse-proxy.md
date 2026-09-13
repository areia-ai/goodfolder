# Putting GoodFolder behind a reverse proxy

The compose file binds every published port to `127.0.0.1`, so a real
deployment puts a TLS proxy in front. Four hostnames are needed:

| Hostname | Forwards to | Serves |
| --- | --- | --- |
| `app.example.com` | `127.0.0.1:4300` | The dashboard |
| `api.example.com` | `127.0.0.1:4100` | The control plane |
| `files.example.com` | `127.0.0.1:4101` | The large-file service |
| `storage.example.com` | `127.0.0.1:9100` | MinIO, for presigned uploads |

The last one is the gotcha people hit: presigned upload URLs point the client
straight at storage, so `storage.` must be publicly reachable, not proxied
through the API. The matching `.env` block:

```bash
PUBLIC_URL=https://api.example.com
WEB_URL=https://app.example.com
WEB_ORIGINS=https://app.example.com
PUBLIC_LFS_ORIGIN=https://files.example.com
PRESIGN_PUBLIC_ENDPOINT=https://storage.example.com
```

The dashboard's API address is baked in when `goodfolder-web` is built, so
after setting `PUBLIC_URL` rebuild that one service:

```bash
docker compose up -d --build goodfolder-web
```

Two things that are true of this stack and shape the proxy setup:

- **Browser uploads do not touch MinIO.** The dashboard sends file bytes to
  the control plane (`POST /api/projects/.../files/upload`); presigned URLs
  are used by the `goodfolder` command's large-file path, which is not a
  browser. So no CORS rule is needed on `storage.` — nothing in the stack
  sets one, and none is required. (If you later serve presigned URLs to a
  browser, give the bucket a CORS rule for the dashboard origin with
  `mc cors set`.)
- **HTTPS is not optional on `api.`** The session cookie is set with
  `Secure` and `SameSite=Lax`, so sign-in only survives on a secure origin.
  Browsers treat `localhost` as secure, which is why the plain-HTTP local
  setup works. Nothing in the stack uses WebSockets or server-sent events,
  so no special streaming or buffering configuration is needed.

## Caddy

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:4300
}

api.example.com {
    reverse_proxy 127.0.0.1:4100
}

files.example.com {
    reverse_proxy 127.0.0.1:4101
}

storage.example.com {
    reverse_proxy 127.0.0.1:9100
}
```

Caddy handles TLS certificates automatically.

## nginx

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;
    # ssl_certificate / ssl_certificate_key here

    location / {
        proxy_pass http://127.0.0.1:4300;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    server_name files.example.com;
    client_max_body_size 0;   # large-file uploads

    location / {
        proxy_pass http://127.0.0.1:4101;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl;
    server_name storage.example.com;
    client_max_body_size 0;   # presigned uploads land here

    location / {
        proxy_pass http://127.0.0.1:9100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Traefik (compose labels)

Add a `docker-compose.override.yml` alongside the main file. Traefik itself
must be running with the Docker provider and an ACME resolver (called
`letsencrypt` here) on a `proxy` network shared with this stack.

```yaml
services:
  goodfolder-web:
    labels:
      - traefik.enable=true
      - traefik.http.routers.gf-web.rule=Host(`app.example.com`)
      - traefik.http.routers.gf-web.tls.certresolver=letsencrypt
      - traefik.http.services.gf-web.loadbalancer.server.port=80
    networks: [goodfolder-net, proxy]

  goodfolder-api:
    labels:
      - traefik.enable=true
      - traefik.http.routers.gf-api.rule=Host(`api.example.com`)
      - traefik.http.routers.gf-api.tls.certresolver=letsencrypt
      - traefik.http.services.gf-api.loadbalancer.server.port=4100
    networks: [goodfolder-net, proxy]

  goodfolder-lfs:
    labels:
      - traefik.enable=true
      - traefik.http.routers.gf-lfs.rule=Host(`files.example.com`)
      - traefik.http.routers.gf-lfs.tls.certresolver=letsencrypt
      - traefik.http.services.gf-lfs.loadbalancer.server.port=4101
    networks: [goodfolder-net, proxy]

  goodfolder-minio:
    labels:
      - traefik.enable=true
      - traefik.http.routers.gf-storage.rule=Host(`storage.example.com`)
      - traefik.http.routers.gf-storage.tls.certresolver=letsencrypt
      - traefik.http.services.gf-storage.loadbalancer.server.port=9000
    networks: [goodfolder-net, proxy]

networks:
  proxy:
    external: true
```

With Traefik routing inside the network, the published `127.0.0.1` ports can
be removed entirely for those four services.
