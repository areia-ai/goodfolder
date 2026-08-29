# Builds one GoodFolder service from source. Used by docker-compose.yml for
# self-hosting: `docker compose up` needs no prior build step on the host.
#
# The production deploy uses infra/Dockerfile.app instead, which copies an
# already-bundled dist/index.js. Both are kept on purpose.
#
#   docker build --build-arg APP=control-plane .
#   docker build --build-arg APP=lfs .

FROM node:22-alpine AS build
ARG APP
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
RUN pnpm install --frozen-lockfile --filter "@goodfolder/${APP}..."

COPY packages ./packages
COPY apps/${APP} ./apps/${APP}

# Same bundle the production deploy produces. The banner restores require()
# for CommonJS dependencies pulled into an ESM bundle.
RUN ./node_modules/.bin/esbuild "apps/${APP}/src/index.ts" \
      --bundle --platform=node --format=esm --target=node22 \
      --outfile=/out/index.js --log-level=warning \
      --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);"

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/index.js ./index.js
CMD ["node", "index.js"]
