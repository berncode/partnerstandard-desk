# PartnerStandard Desk on a company's own server (plan 17; spec 2026-11-07 §10): one image, the Next.js standalone server.
# Its data lives only in /data; it runs as uid 1000; every setting comes from the environment (deploy/.env.example).
# No setting is read while it builds, so no secret ever lands in a layer.
#
#   docker build -t partnerstandard-desk .
#   docker run -p 3000:3000 -v partnerstandard-desk-data:/data --env-file .env partnerstandard-desk
#
# NODE_IMAGE lets a build use a mirror of the same image when Docker Hub is out of reach. Behind a proxy that inspects
# HTTPS, hand the build its certificate as a secret (never a layer): --secret id=ca,src=/path/to/proxy-ca.crt
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV NEXT_TELEMETRY_DISABLED=1 CI=1
RUN --mount=type=secret,id=ca NODE_EXTRA_CA_CERTS=/run/secrets/ca npm install --global --no-fund --no-audit pnpm@11.11.0
WORKDIR /src
# The manifests first, so a change to the code alone reuses the installed packages.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/commands/package.json packages/commands/
COPY packages/copy/package.json packages/copy/
COPY packages/core/package.json packages/core/
COPY packages/method/package.json packages/method/
COPY packages/platform/package.json packages/platform/
COPY packages/storage/package.json packages/storage/
RUN --mount=type=secret,id=ca NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm install --frozen-lockfile
COPY . .
RUN --mount=type=secret,id=ca NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm build
# The licenses of the open source packages the image holds: their own notices, which must go with every copy.
RUN node scripts/release/third-party-licenses.mjs /src/THIRD_PARTY_LICENSES

FROM ${NODE_IMAGE} AS run
# A release's version and repository (the release workflow sets them): Settings compares them with the newest release
# on GitHub. Any other build has none, and never asks.
ARG APP_VERSION=
ARG APP_REPO=
ENV APP_VERSION=${APP_VERSION} APP_REPO=${APP_REPO}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    EDITION=self-hosted DATABASE_URL=file:/data/partnerstandard-desk.db \
    HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# The standalone server with the files it needs (the migrations among them, next.config.ts), then the files Next
# leaves out of it: the built CSS and scripts, and the public folder. All owned by root: the app can't change itself.
COPY --from=build /src/apps/web/.next/standalone ./
COPY --from=build /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /src/apps/web/public ./apps/web/public
# The licenses, with what they cover: the code's (AGPL-3.0-only), the method content's (CC BY 4.0, with its credit) and
# the open source packages' own (THIRD_PARTY_LICENSES).
COPY LICENSE /app/LICENSE
COPY packages/method/LICENSE packages/method/README.md /app/packages/method/
COPY --from=build /src/THIRD_PARTY_LICENSES /app/THIRD_PARTY_LICENSES
# The image's user, uid 1000 ("node" in the Node image), owns /data and nothing else.
RUN mkdir -p /data && chown 1000:1000 /data
USER 1000:1000
VOLUME /data
EXPOSE 3000
# /api/health answers once the database does (plan 17, task 1). The slim image has no curl: Node asks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# server.js runs instrumentation first: the copy of the database, the migrations, then it serves.
CMD ["node", "apps/web/server.js"]
