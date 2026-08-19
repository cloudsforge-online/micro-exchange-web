# syntax=docker/dockerfile:1
#
# Two stages: build the bundle, then serve it. The final image contains no Node, no toolchain, no
# source and no secret — an SPA is static files, and everything else in the image is attack surface
# for something it does not need to do.
#
# THE IMAGE CARRIES NO ENVIRONMENT. It is built once, tagged once, and the same tag is promoted from
# staging to production; the hosts it talks to are resolved in the browser from the address the page
# was served on (src/lib/hosts.ts). There is deliberately no build arg for an API URL, and no build
# arg for the JSON-RPC endpoint either — which is the one this surface would be tempted by, since
# every number on every page comes from it. It is derived from the page address (src/lib/rpc.ts) for
# the same reason everything else is.
#
# THERE IS ALSO NO CONTRACT ADDRESS BAKED IN AT BUILD TIME, and that is the version of the rule
# particular to this surface. The factory, the router and the init-code hash live in
# `src/lib/dex.ts` as a frozen table keyed by chain id, COMMITTED — they are facts about a chain,
# identical on every deployment that talks to that chain, and a reader can check every one of them
# from `/contracts` in their own browser. A build arg would make them a property of the deploy
# instead, which is exactly the thing this surface exists to let somebody verify.
#
# THERE IS NO SERVICE TOKEN IN THIS IMAGE, AND THAT IS THE HARDER RULE. Nothing here is
# authenticated: every read is an anonymous `eth_call` and every write is signed by the reader's own
# wallet, so there is no credential this bundle could hold that would mean anything. The rule
# survives the reason, because the reflex it guards against does not depend on it — an image is
# built once and promoted, pushed to a registry and pulled by anything with read access, so a
# credential inside one is a published credential whatever it was for. `nginx.conf` proxies nothing
# and CI greps both files.

# The named context is the unpublished @cloudsforge/ui workspace, mirroring the `link:` specifier in
# package.json. It disappears when the package is published; see the README.
#   docker build -t exchange-web --build-context uipkg=../ui .

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# The linked package must exist before `pnpm install` resolves the `link:` dependency, and it is
# copied first because it changes far less often than this app's source.
COPY --from=uipkg packages/ui /ui/packages/ui
# esbuild reads the nearest tsconfig for each file it transforms, and the design system's extends the
# one at its repository root. Without it the build fails inside a file this app does not own.
COPY --from=uipkg tsconfig.base.json /ui/tsconfig.base.json

# pnpm-workspace.yaml carries the esbuild build-script allowance; without it the toolchain installs
# and then cannot run.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# ══════════════════════════════════════════════════════════════════════════════════════════════
# public/ — THE LINE THAT ONCE WAS NOT IN THE TEMPLATE.
#
# Vite copies `publicDir` into `dist` during the build, so the favicons and the og card only reach
# the image if they are in the build context. The web template's Dockerfile used to copy tsconfig,
# vite.config, index.html and src — and not public — so every frontend cut from it built an image
# whose `dist/` had no favicon in it, while `brand-chrome.test.ts` went on passing because it reads
# the SOURCE tree. Four frontends shipped that way: icons wired, committed, tested, and absent from
# the artefact actually served.
#
# It is fixed upstream now, and this line was copied only after `micro-web-template/Dockerfile` was
# opened and read — not on the strength of a sibling's comment saying so. Both
# `test/brand-chrome.test.ts` (which reads this file) and the image probe in ci.yml (which curls the
# running container for each asset) fail without it.
# ══════════════════════════════════════════════════════════════════════════════════════════════
COPY public ./public

# The release identity: the git sha, stamped into the meta tag src/lib/obs.ts reads, so an error
# report names the deploy that produced it. It identifies the artefact; it does not configure it.
ARG RELEASE=dev
RUN sed -i "s|name=\"cf-release\" content=\"dev\"|name=\"cf-release\" content=\"${RELEASE}\"|" index.html \
 && pnpm build

# nginx-unprivileged: the server runs as uid 101 and listens on 8080. A static file server has no
# reason to be root, and a container that cannot become root cannot be made to write anywhere.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf

# ══════════════════════════════════════════════════════════════════════════════════════════════
# THERE IS NO nginx TEMPLATE AND NO RUNTIME ENVIRONMENT VARIABLE IN THIS IMAGE, AND THAT IS A
# DIFFERENCE FROM pool-web WORTH STATING RATHER THAN LEAVING AS AN ABSENCE.
#
# pool-web ships `deployment.inc.template` and `ENV POOL_API_PRESENCE`, expanded by the stock
# entrypoint at container start, because it has one fact it cannot work out for itself: whether a
# micro-pool exists behind this hostname at all on this estate (micro-org#406). Its API is under a
# compose profile that testnet does not enable, so `/v1` answers 502 there and the console had no
# way to tell "deliberately absent" from "broken".
#
# This surface has no such fact. Everything it needs is either committed (the deployment table in
# `src/lib/dex.ts`, keyed by chain id) or discoverable from the chain in the browser: the bundle
# asks the endpoint for `eth_chainId` and looks the answer up. A chain with no exchange on it
# renders the "no deployment here" state from a MEASUREMENT rather than from a flag, which cannot
# be wrong in the direction that matters — the flag can say `absent` on an estate that has one.
#
# So the container is entirely static and its behaviour is a function of the URL it was fetched
# from and the chain that answers. If a flag ever does become necessary here, the argument for the
# `.inc` extension (the output directory IS `conf.d`, which the packaged nginx.conf includes as
# `*.conf`, so a generated `.conf` becomes a second `server` block on 8080) and for an `ENV`
# default (envsubst has no `${VAR:-default}`, and an unset variable reaches nginx verbatim and
# fails the parse — measured, the container exits 1) is in pool-web's Dockerfile and nginx.conf.
# ══════════════════════════════════════════════════════════════════════════════════════════════

# THE MOUNT IS APPLIED HERE, NOT IN THE BUILD. `dist/` stays flat, so the prerender and the tests
# that read it keep asserting the paths they were written to assert, and the one place that knows
# this surface lives under `/exchange` on the way out is the copy into the image.
COPY --from=build /app/dist /usr/share/nginx/html/exchange

EXPOSE 8080

# Liveness only. It proves nginx is answering, not that the app works — and on this surface it is
# especially narrow: the thing that decides whether a swap is possible is a contract on a chain on
# another machine, which this container cannot see and must not claim to speak for. A green probe
# here is compatible with every pool on the exchange being empty.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
