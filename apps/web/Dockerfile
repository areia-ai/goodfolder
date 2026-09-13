# The dashboard and landing page as a static site behind nginx, for
# self-hosting. docker-compose.yml builds it as `goodfolder-web`.
#
# NEXT_PUBLIC_API_URL is baked into the JavaScript at build time — the site is
# a static export, so there is no runtime to read it later. Serving the
# dashboard on a domain means rebuilding this one service with the new
# address:
#
#   docker compose up -d --build goodfolder-web

FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

# Manifests first so dependency layers cache independently of source edits.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/serverlib/package.json ./packages/serverlib/
COPY apps/control-plane/package.json ./apps/control-plane/
COPY apps/lfs/package.json ./apps/lfs/
COPY apps/cli/package.json ./apps/cli/
COPY apps/mcp/package.json ./apps/mcp/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter "@goodfolder/web..."

# The web app imports nothing from packages/, so only its own source is needed.
COPY apps/web ./apps/web

# Baked into the static bundle at build time (see the header comment).
# NEXT_PUBLIC_POSTHOG_KEY stays empty: no analytics on a self-hosted install.
ARG NEXT_PUBLIC_API_URL=http://localhost:4100
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_POSTHOG_KEY=
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
RUN pnpm --filter @goodfolder/web build

FROM nginx:alpine
COPY --from=build /src/apps/web/out /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
