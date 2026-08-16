# micro-exchange-web

[![ci](https://github.com/cloudsforge-online/micro-exchange-web/actions/workflows/ci.yml/badge.svg)](https://github.com/cloudsforge-online/micro-exchange-web/actions/workflows/ci.yml)
![licence](https://img.shields.io/badge/licence-MIT-97CA00)
![node](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![module](https://img.shields.io/badge/module-ESM-F7DF1E?logo=javascript&logoColor=black)
![tests](https://img.shields.io/badge/tests-in--process%20DOM-6E56CF)

The public front for Forge Exchange: swap one token for another against a constant-product pool on
Hearth, see every market the factory has made, and re-run the checks that say the contracts are what
they claim to be. It is a static SPA served by nginx — no Node, no toolchain and no environment in
the image.

> ## **Nothing here is custodied, and there is no service behind this page.**
>
> There is no `micro-exchange`. No CloudsForge process holds a coin, quotes a price, keeps a
> balance or has an account for you. Every number on every page is an `eth_call` made **by your own
> browser** against the estate's public JSON-RPC endpoint, and every transaction is signed by a
> wallet CloudsForge did not issue and cannot revoke.
>
> That is the product, not a caveat — but it cuts both ways, and the page says so in the chrome
> above every route: **there is no support desk, no reversal and no recovery.** A pool anybody can
> create is a pool anybody can create badly, or dishonestly. `/contracts` exists so a stranger can
> check the claims on this page rather than take them.

The counterpart repositories are [`micro-hearth`](https://github.com/cloudsforge-online/micro-hearth)
(the chain), [`micro-explorer-web`](https://github.com/cloudsforge-online/micro-explorer-web) (which
every address here links out to) and `docs/ecosystem/39-forge-exchange.md` in `micro-org`, which is
the plan this surface is phase H of.

## Routes this app serves

Three, and that is the whole surface.

| Path             | What it is                                                                    |
| ---------------- | ----------------------------------------------------------------------------- |
| `/`              | The swap form: a pair, an amount, the router's quote, and the curve it sits on |
| `/pools`         | Every pair the factory reports, with reserves, newest first                    |
| `/pools/<pair>`  | One market: its two tokens, its reserves, and whether it is the canonical pair |
| `/contracts`     | The addresses, and the checks — re-run in the reader's browser                 |

`ROUTES` in `src/lib/routes.ts` is the single table. The `<Route>` elements in `src/app.tsx` and the
`location` blocks in `nginx.conf` are checked against it as text by `test/routes.test.ts`, because
three hand-maintained lists that must agree is two lists too many to trust.

There is deliberately **no "add liquidity" page and no positions page.** Both need write paths this
surface has not built, and a menu entry leading to an explanation of why a feature is missing is
worse than the absence: it implies somebody decided against it, rather than that phase H scoped this
to a swap, a list and a proof.

### Everything unknown is a real 404

The usual SPA fallback is `try_files $uri /index.html`, which answers **200 for every address in
existence**. That makes a "page not found" screen a success: crawlers index it, uptime checks call
it healthy, and a deploy that drops a route looks exactly like a deploy that did not.

So the client routes are enumerated in `nginx.conf` and everything else falls through to
`error_page 404 /index.html` — the same bundle, the honest status. React renders `NotFoundPage`
inside it.

`/swap` is the interesting case and it is asserted in CI: the swap **is** the index route, `/swap`
is the address a reader will guess, and it answers 404. A guessed address that silently succeeds on
a page carrying a Swap button is a worse outcome than a page that says it does not exist.

## What it talks to: the chain, and nothing else

`src/lib/rpc.ts` composes one address — `https://rpc.<apex>` — from the page's own hostname, a label
at a time. Nothing in `src/` names a CloudsForge hostname (`test/no-build-time-config.test.ts`
enforces it, and the `rules` CI job repeats the grep so deleting the test does not delete the rule).

There is no `apiBase()` in `src/lib/hosts.ts` and no `lib/auth.tsx` in this bundle at all. The
reads are:

| Read                                                | Contract                        |
| --------------------------------------------------- | ------------------------------- |
| `allPairsLength()`, `allPairs(i)`, `getPair(a,b)`    | the factory                     |
| `getReserves()`, `token0()`, `token1()`, `totalSupply()` | the pair                    |
| `name()`, `symbol()`, `decimals()`                   | each ERC-20                     |
| `getAmountsOut(path)`                                | the router — **the quote**      |
| `pairCodeHash()`, `feeTo()`, `feeToSetter()`         | the factory — the two traps     |
| `eth_chainId`, `eth_blockNumber`                     | the node                        |

No cache, no store, no subscription. A quote is worth what it was worth at the block it was read
at, so `src/lib/market.ts` re-reads on every render that needs a number and every page prints the
block height its answers came from. A cached reserve is a stale price wearing a live one's clothes.

`null` propagates and is never collapsed. A read that failed produces `null` all the way up to the
component, which renders "the pool could not be read" — never a zero, never an empty pool, never a
price. The distinction `micro-pool-web` learned the hard way is kept explicitly here: the pair list
answers `null` when the **factory** could not be read and `[]` when the factory answered and has
made nothing, because "this node is down" and "nobody has created a market yet" are opposite things
to tell somebody who came here to trade.

### It is cross-origin, and that is a deploy fact this bundle depends on

Every other frontend in the estate is same-origin with its API (`apiBase()` returns `''`). This one
is not, and cannot be: `exchange.<apex>` calling `rpc.<apex>` is a different origin by construction.
That makes this surface's origin a required entry in the `cf-cors` allowlist in
`deploy/gateway/dynamic/policy.yml`.

That list is **derived from the surface registry's `servesUi` flag** by `surface-routes.py` check 5,
so flipping `exchange` to `servesUi: true` is what grants it — there is no separate entry to
remember, and a hand-added one would be deleted by the next render.

Measured before this surface existed, on 2026-08-16:
`OPTIONS https://rpc.cloudsforge.online/` with an `exchange.` origin answered 200 with
`access-control-allow-credentials: true` and **no `access-control-allow-origin`** — which a browser
reads as a refusal. The same request with a `pool.` or `foresight.` origin got one. That gap is what
the registry flip closes.

No credential is ever sent: `credentials` is left at its default of `omit`, because a chain read is
public and a cookie on it would be a cookie sent to an endpoint with no use for one.

### The endpoint follows the VIEWED network, not the hostname

`rpcUrl()` reads `viewedNetwork()`, so pressing **Testnet** in the switcher re-points the chain this
page reads instead of navigating away from it (micro-org#459). `<Outlet key={viewed}>` in the shell
remounts every page on the change, so no component can carry a mainnet reserve into a testnet
render.

On a local stack `rpcUrl()` returns `null` and every page renders "there is no chain endpoint for
this address". There is no localhost default: a guessed dev port for a chain node fails as a
connection refused with no explanation, and a stated absence is a better answer than a spinner.

### Nothing in the error ever carries the URL

A `fetch` rejection puts the whole request URL in the exception message, and an RPC URL with a
credential in it is then printed by any handler that logs `err.message`. That is how bitcoind's
`rpcauth` leaked once, and no redaction rule catches it, because the leak is inside a string that
looks like prose. So every throw in `src/lib/rpc.ts` is built from the node's own `error.message` or
from a fixed sentence, and the caught exception is discarded **without being read** — `catch {}`
with no binding, so there is nothing to accidentally log.

## The deployment is keyed by chain id

`DEPLOYMENTS` in `src/lib/dex.ts` is a frozen table with one row today:

| | |
| --- | --- |
| chain | **7411** — Hearth, native symbol `EMBER` |
| factory | `0x8e41e083cd664a5d65d047198338e5f110ee883f` |
| router | `0x74a991fedb2e09aa23faffa9bdf4ca5dbbeb0527` |
| wrapped native | `0xdae7f901bc0ea6cb8a77c160e355007981e351e1` |
| init code hash | `0x46b4122ae9db4a03c913cfbed4e6321064741545c60aafe3ed9410be7657a537` |
| multicall | `0xe1636b08ff1edde24b2642a3cb388d4e97dfe0bc` |

**A chain id, not a hostname and not an environment variable.** A hostname can be re-pointed and a
variable can be stale, and both failures render the same way: a working-looking swap form aimed at a
factory that is not there — or, worse, at a different one. `eth_chainId` is read from the node on
every load, `deploymentFor()` looks the answer up, and `null` is a **rendered state**
("Forge Exchange is not deployed on this network"), not an error.

This is also why there is no `deployment.json` in this image and no `envsubst` in its entrypoint.
`micro-pool-web` needs one because "is the pool deployed here" is not a question a browser can
answer for itself. Here it is. One artefact, promoted unchanged, whose behaviour on a network
without an exchange is decided by the chain rather than by a variable somebody has to remember to
set. CI asserts `/deployment.json` answers 404.

**There is no testnet row, and the table is frozen.** Testnet renders the not-deployed state and
says so plainly, which is the correct answer until phase G puts contracts there.

## The two traps

`/contracts` does not assert that the contracts are honest; it **performs the checks**, live, from
the bundle already running in the reader's browser, and prints both sides of every comparison. A
green tick somebody chose to render is exactly what a convincing fake renders too.

**Trap 1 — the init-code hash.** The V2 router derives a pair's address with CREATE2 from a
hard-coded `INIT_CODE_HASH`. A fork that recompiled `UniswapV2Pair` — a different compiler version
is enough — and did not update that constant produces a router whose every swap is sent to an
address with no code at it, while `factory.getPair()` goes on answering correctly. Nothing looks
wrong until the first real trade reverts.

So the page asks the factory for its own `pairCodeHash()`, compares it with the constant this bundle
was built with, and then **independently derives** a live pair's address from that constant with
keccak-256 in the browser (`src/lib/keccak.ts`, no dependency) and compares the result with
`getPair()`. Two comparisons: the first catches a wrong constant, the second catches a wrong
derivation. The same derivation runs on `/pools/<pair>`, which is how a pool page can tell a reader
that an address is **not** the canonical pair for its two tokens and should be treated with
suspicion.

**Trap 2 — the fee switch.** `feeTo() == 0x0` is what makes "the 0.3% stays in the pool" true, and
`feeToSetter()` is the address that can change that at any moment without asking anybody. Both are
printed. Saying "no protocol fee" without naming who can start charging one would be a truth with a
misleading shape.

## The arithmetic is ported; the quote is not

`src/lib/dex.ts` ports `UniswapV2Library`'s constant-product formulae in exact `bigint` arithmetic —
`getAmountOut`, `getAmountIn`, `quote`, `priceImpactBps`, `minimumOut`, `curvePoints` — so the swap
page can draw a **curve**: a hundred hypothetical fills, which would otherwise be a hundred round
trips for a picture.

**The number beside the Swap button is `getAmountsOut` from the router**, always. These functions
agreeing with the chain is the sort of thing that is true until a parameter changes; if one ever
does, the picture goes slightly wrong and the number stays right, which is the correct way round for
that failure.

`test/dex.test.ts` pins the port against the reference formulae in exact integer arithmetic and
against the invariants they exist to preserve: `k` never falls, `getAmountIn` is the minimal inverse
of `getAmountOut`, every division truncates in the pool's favour, and a pool cannot be emptied at
any price. Those are checks against the **definition**. Its header says plainly that nobody has
replayed a mainnet fill into that file, because a comment claiming otherwise would be the expensive
kind of wrong — it retires the suspicion that makes somebody go and check.

## The wallet is the identity, and reading needs none

Every route renders for everybody. The chain is public, so gating a number an explorer hands over
for free behind a session would be theatre; the `rules` job fails the build on `ProtectedRoute`,
`RequireAuth`, `AuthProvider` or `Authorization` appearing anywhere in `src/`.

Writing needs a wallet, and only a wallet. `src/lib/wallet.ts` speaks EIP-1193 directly — no
WalletConnect, no wagmi, no viem — and builds three transactions: `approve`, `swapExactTokensFor*`
and the native `deposit()` wrap. It never asks for accounts on load; `eth_requestAccounts` happens
when somebody presses Connect, because a page that opens a wallet prompt before being asked has
taught the reader to dismiss prompts.

`bootstrapSession()` is absent from `src/main.tsx` for the reason the whole surface exists: a
CloudsForge session is not a credential any chain node has heard of, and a "Sign in" affordance
beside Connect would imply the two are alternatives. They are not — only one of them can sign a
swap.

`CloudsForgeBar` is not mounted either, and `test/shared-chrome.test.ts` holds that to a product
argument rather than a gap: `surface('exchange')` resolves perfectly well (the footer is mounted
from the same registry). The bar's account control has nothing behind it here. What the absence must
**not** take with it is the network switcher, which is mounted directly and asserted, so this does
not become the one surface in the estate that cannot be read on the other network.

## Configuration

**There is none.** No `VITE_` variable, no `import.meta.env`, no `process.env` in `src/`, no
environment in the image, and no per-deployment file. Hosts come from `window.location` at runtime;
the chain comes from `eth_chainId`. `test/no-build-time-config.test.ts` and the `rules` CI job both
enforce it.

The one build argument is `RELEASE`, stamped into `<meta name="cf-release">` so an error report can
be pinned to the deploy that introduced it.

### The registry row

`exchange` is registered in `ui/packages/ui/src/surfaces.ts` as `kind: 'service'`, subdomain
`exchange`, accent `#b28e1e`, glyph `⇄`, `inSwitcher: false`, `markId: null`.

`markId: null` is a decision and not a gap — the same one `explorer` and `pool` carry. The exchange
is chain infrastructure and belongs to Forge Network rather than being a product with a mark of its
own; nothing in this bundle renders one, and `test/brand-chrome.test.ts` asserts there is none to
render.

`kind: 'service'` matters mechanically: the accent guard in `surfaces.test.ts` holds *products* to a
strict bijection with `PRODUCT_ACCENTS`, so a seventh product would mean choosing a seventh accent
by the documented CIEDE2000 procedure — design work that belongs to a later decision, not to the
phase that ships the frontend. The gold block is shared with `create` and `pool`, and `tokens.css`
already declares it.

`devPort` is **5194** — this repository's own vite server, and the only entry in the registry that
names a dev server rather than a service, because there is nothing to call. It is not the container
port: the image is `nginx-unprivileged`, nothing in it is root, a non-root process cannot bind 80,
and `nginx.conf` therefore listens on 8080.

### Brand

The favicons and the og card in `public/` are **copies of CloudsForge's own**, and a copy that is
never compared is a copy that drifts — so `test/brand-chrome.test.ts` compares them byte for byte
against the `micro-brand` checkout, and asserts that `brand/assets/exchange/` does **not** exist.
The day micro-brand generates a set for this surface, the borrow stops being the right answer and
that test says so.

The footer's legal links are composed by `CloudsForgeFooter` from the registry, so nothing in this
repository would notice a path that stopped resolving. The same test resolves them against a
`micro-site` checkout — `status-web` paid for skipping that with two broken footer links from the
day they were written.

## The empty state is a real state, and it is not an error

A factory with no pairs, a chain with no deployment, a pair with one empty side, a node that will
not answer: four different things, four different sentences, and none of them a spinner that never
resolves.

- **No deployment on this chain** → "Forge Exchange is not deployed on this network."
- **No endpoint** (local, or an unregistered hostname) → "There is no chain endpoint for this address."
- **The factory answered, and has nothing** → "The factory has not created a market yet."
- **The factory did not answer** → "The factory did not answer", with a *Read again* button.
- **A pair with no reserves** → no price at all. `null` is not zero, and a zero price is a lie with a number in it.

The pair list is bounded at 50 and the bound is **reported**: `/pools` prints the factory's own
count beside the number of rows, because a truncation nobody mentions reads as "that is all there
is" — the wrong thing to tell somebody looking for a market.

## Running it

```sh
pnpm install            # needs ../ui, the design system, checked out as a sibling
pnpm dev                # http://localhost:5194
pnpm typecheck
pnpm test
pnpm build
```

`@cloudsforge/ui` is consumed as `link:../ui/packages/ui` because it is not published yet. `link:`
rather than `file:`: `link:` symlinks the working tree, so an edit in the design system is visible
here without a republish, while pnpm *packs* a `file:` directory and honours its `files` field —
which lists only `dist`, leaving an exports map pointing at sources that were never packed.

The test script needs `--import @cloudsforge/ui/test-loader`. Node resolves a bare specifier from
the importing file's **realpath**, so without it the design system's components find micro-ui's own
copy of React, share no dispatcher with ours, and every hook they call throws "Cannot read
properties of null (reading 'useState')". The loader is vite's `resolve.dedupe`, supplied to the
Node test runner, which has none of its own.

Against a real estate, run the built bundle behind a hostname the registry knows — the chain
endpoint is derived from the apex, so `localhost` has none and the pages say so.

### What the tests actually hold

There is no browser here. `test/dom.ts` renders into `happy-dom` in-process, so a test can read the
words on a page in about a second.

| File | What it would catch |
| --- | --- |
| `render.test.ts` | Every route rendered against a stubbed chain, and the words read. The custody sentence, the not-deployed state, the "anyone may create one" line on a missing pool, the impostor warning. |
| `dex.test.ts` | The ported arithmetic against the reference formulae and their invariants. |
| `routes.test.ts` | `ROUTES` ↔ `app.tsx` ↔ `nginx.conf` drifting apart. |
| `no-build-time-config.test.ts` | A `VITE_` variable or a literal hostname reaching `src/`. |
| `seo.test.ts` | The description meta drifting from `SURFACE_DESCRIPTION`; the environment alternation in `nginx.conf` drifting from `ENV_LABELS`. |
| `shared-chrome.test.ts` | The custody notice leaving the shell; the network switcher leaving with the bar. |
| `brand-chrome.test.ts` | A favicon drifting from micro-brand's; an accent selector that does not exist upstream. |
| `tokens.test.ts` | A `cf-` class this app uses that the design system does not define. |
| `viewed.test.ts`, `hosts.test.ts`, `format.test.ts`, `obs.test.ts` | The network view, the registry placement check, the formatters, the error reporter. |

The two cross-repository tests **skip** when the sibling is absent, so `pnpm test` passes for
somebody who cloned only this repository. On the runner a skip is fatal — CI parses the reporter's
summary line for it — because a checkout that silently produced nothing looks exactly like a green
cross-check.

## Known gaps

- **No liquidity provision.** You cannot add or remove liquidity from this surface, or see a
  position. Phase H scoped this to a swap, a list and a proof; `docs/ecosystem/39` §6 is where the
  next phase is argued, not here.
- **No token list, and that is partly deliberate.** The swap form takes addresses and the pool list
  comes from the factory. A curated list would be a recommendation, and an exchange whose factory is
  permissionless cannot vouch for any market on it. A *searchable* list of what the factory has made
  is a different thing and is worth building.
- **No testnet deployment.** `DEPLOYMENTS` has one row. Testnet renders the not-deployed state.
- **No wrapped coin against custody** — phase G in the plan, and an owner decision rather than an
  engineering one.
- **`/pools/<address>` is absent from the sitemap**, deliberately: the set is unbounded and not this
  repository's to enumerate, and a pair address in the one document a crawler treats as
  authoritative reads as this site vouching for that market.
- **The pair list is a page, not the whole set.** 50 rows, reported.

## Provenance

Cut from the estate's web template, like every other frontend here: React 19, react-router 7, vite 6,
TypeScript strict, `@cloudsforge/ui` for tokens and chrome, nginx-unprivileged for the image, and the
same `publish-image.yml` producer every deployable uses. What is not from the template is everything
in `src/lib/` below `hosts.ts`: this is the only surface in the estate whose data source is a chain
rather than a CloudsForge service, and the only one whose requests are cross-origin on purpose.
