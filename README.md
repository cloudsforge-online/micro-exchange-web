# micro-exchange-web

[![ci](https://github.com/cloudsforge-online/micro-exchange-web/actions/workflows/ci.yml/badge.svg)](https://github.com/cloudsforge-online/micro-exchange-web/actions/workflows/ci.yml)
![licence](https://img.shields.io/badge/licence-MIT-97CA00)
![node](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![module](https://img.shields.io/badge/module-ESM-F7DF1E?logo=javascript&logoColor=black)
![tests](https://img.shields.io/badge/tests-in--process%20DOM-6E56CF)

The public front for Forge Exchange: swap one token for another against a constant-product pool on
Hearth, put liquidity into a pool and take it back out, create a market the factory has never seen,
see every market it has made, and re-run the checks that say the contracts are what they claim to
be. It is a static SPA served by nginx — no Node, no toolchain and no environment in the image.

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

Four top-level, and every page the write half added is a **child of `pools`**.

| Path                   | What it is                                                                     |
| ---------------------- | ------------------------------------------------------------------------------ |
| `/`                    | The swap form: a pair, an amount, the router's quote, and the curve it sits on  |
| `/pools`               | Every pair the factory reports, with reserves, newest first                     |
| `/pools/<pair>`        | One market: its two tokens, its reserves, and whether it is the canonical pair  |
| `/pools/<pair>/add`    | Put both sides in — or open an empty pool, at a price you are choosing for it   |
| `/pools/<pair>/remove` | Take them back out, with both amounts quoted from reserves before you sign      |
| `/pools/positions`     | What the connected wallet holds, swept from the factory's own list of pairs     |
| `/pools/new`           | Create a market. The factory is permissionless — verified, not assumed          |
| `/receipts`            | The Forge Receipts: whose promise, what is behind it, and how to count it yourself |
| `/contracts`           | The addresses, and the checks — re-run in the reader's browser                  |

`ROUTES` in `src/lib/routes.ts` is the single table. The `<Route>` elements in `src/app.tsx` and the
`location` blocks in `nginx.conf` are checked against it as text by `test/routes.test.ts`, because
three hand-maintained lists that must agree is two lists too many to trust. The cross-check compares
**first segments**, which is what lets the four liquidity pages exist without a fourth list to
maintain: `pools` is already `wildcard: true`, so the router mounts them and nginx already serves
them.

They are children rather than a fifth navigation entry because that is what they are *about*.
Somebody looking for their own liquidity is looking at the market list; a top-level "Liquidity" tab
beside "Pools" would be two names for one subject, and the reader would have to learn which of the
two holds the page they want. `positions` and `new` cannot be mistaken for a pair address — a pair
segment is twenty bytes of hex and `PoolPage` rejects anything that is not — and both are declared
before `:pair` in `app.tsx` so the ordering is visible rather than resting on react-router's
ranking rule.

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
| `balanceOf(owner)`, `allowance(owner, router)`       | each ERC-20, **and the pair**   |
| `getAmountsOut(path)`                                | the router — **the quote**      |
| `pairCodeHash()`, `feeTo()`, `feeToSetter()`         | the factory — the two traps     |
| `eth_chainId`, `eth_blockNumber`, `eth_getBalance`   | the node                        |
| `eth_getTransactionReceipt`                          | the node — did it work          |

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

`DEPLOYMENTS` in `src/lib/dex.ts` is a frozen table with two rows:

| | **7411** — Hearth | **7412** — Hearth Testnet |
| --- | --- | --- |
| factory | `0x8e41e083cd664a5d65d047198338e5f110ee883f` | `0x18bbd09d51f4e9e630dd0a86fc984b6326f10e41` |
| router | `0x74a991fedb2e09aa23faffa9bdf4ca5dbbeb0527` | `0xba2b9db822e1f2ec3039fe474644b8405268a9b4` |
| wrapped native | `0xdae7f901bc0ea6cb8a77c160e355007981e351e1` | `0xa26dfebc362a380e1ade6090c7c5887180d1b263` |
| init code hash | `0x46b4122a…7657a537` | the same constant, and it has to be |
| multicall | `0xe1636b08ff1edde24b2642a3cb388d4e97dfe0bc` | `0x76db8cdcaf4a517a51ae474bd00cfe9a53635c03` |

Both rows were **re-read from the node** before being written down, not copied out of a deployment
note: `router.factory()`, `router.WETH()`, `allPairsLength()` and `multicall3.getChainId()` all
answer as above, and on each chain the one live pair recomputed by CREATE2 from the constant equals
`factory.allPairs(0)` exactly. The block numbers in that table were found by bisecting
`eth_getCode`, so each is the block an address first had code in rather than the block a script
logged.

The two deployments are **not** the same bytecode — 7412 predates the factory and multisig fixes
from §6 phase E — but `initCodeHash` is identical and has to be: the pair contract did not change,
and `bytecodeHash: 'none'` means editing the factory cannot perturb it.

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

**The table has to be exactly as long as the truth is, in both directions.** A row for a chain with
no deployment renders a swap form against contracts that are not there and every quote on it fails.
A missing row for a chain that *does* have one tells a reader "Forge Exchange is not deployed on
this network" about a market they can see on the explorer — the same lie with the sign flipped, and
it is the one this file shipped with: the testnet row was absent for four days after phase D had
already deployed the full set on 7412. It is present now because it was read off the node, and a
third chain gets a row on the same terms and no others.

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
WalletConnect, no wagmi, no viem — and builds six transactions: `approve`, `swapExactTokensFor*`,
the native `deposit()` wrap, `addLiquidity`/`addLiquidityETH`, `removeLiquidity*` and
`createPair`. It never asks for accounts on load; `eth_requestAccounts` happens when somebody
presses Connect, because a page that opens a wallet prompt before being asked has taught the reader
to dismiss prompts.

**Every one of those six is calldata handed to a wallet this estate did not issue.** Nothing in this
repository holds a key, and there is no route that could: no backend exists to hold one. The write
pages fail closed on that — with no injected provider they still render every number, and the button
says what is missing instead of pretending.

`bootstrapSession()` is absent from `src/main.tsx` for the reason the whole surface exists: a
CloudsForge session is not a credential any chain node has heard of, and a "Sign in" affordance
beside Connect would imply the two are alternatives. They are not — only one of them can sign a
swap.

`CloudsForgeBar` is not mounted either, and `test/shared-chrome.test.ts` holds that to a product
argument rather than a gap: `surface('exchange')` resolves perfectly well (the footer is mounted
from the same registry). The bar's account control has nothing behind it here. What the absence must
**not** take with it is the network switcher, which is mounted directly and asserted, so this does
not become the one surface in the estate that cannot be read on the other network.

## The write half: liquidity, and the five ways it costs money

Swapping is one signature against a price you can see. Providing liquidity is not, and the four
pages under `/pools` are shaped around the five things that cost money quietly.

**A pending transaction is a state.** `src/lib/tx.ts` keeps every hash this page broadcast until the
chain answers, in four states: `pending`, `mined`, `reverted`, and `lost` — the last meaning *this
page stopped asking*, which is a fact about the page and not a verdict on the transaction. The shape
it replaces is on every exchange frontend and was on this one: send, print "sent", never mention it
again. That cannot say the sentence that matters most — **mined and reverted**, where gas was spent,
the hash is real, the explorer link works, and nothing moved. Receipts are polled through
`lib/rpc.ts`, the same public endpoint every other number came from, rather than through the
injected provider, so a wallet pointed at a different node cannot produce a receipt that disagrees
with the reserves printed beside it. Nothing is persisted: the authority on what happened is the
chain, and a list of transaction hashes written to disk by a page nobody asked to keep them is a
privacy decision made on somebody's behalf.

**The first deposit into an empty pool sets the price, and nothing puts it back.** Supplying to a
pool that has reserves is bounded — the ratio is fixed by the pool and the router will not let a
deposit move it. A *first* deposit has no ratio to conform to, so whatever is deposited becomes the
price, and an arbitrageur takes the difference out of the depositor on the first trade. It is the
one place on this surface where a typo costs a large fraction of the stake, so `/pools/<pair>/add`
detects the empty pool, unlocks the two sides from each other, prints the price the deposit is about
to declare, and says so in `FIRST_DEPOSIT_WARNING` at the moment of signing rather than in a note
somewhere above.

**Approvals are separate transactions, and they do not all go to the same place.** Depositing
approves the **router** on each non-native token; withdrawing approves the router on the **pair**,
which is itself an ERC-20 and is the contract people get wrong. Both approve the exact amount rather
than an unlimited allowance. `test/render.test.ts` asserts the `to` of each, because an approval
sent to the wrong contract succeeds, costs gas, and changes nothing.

**Price impact and slippage tolerance are different things and are never merged.** Impact is what
*your* trade does to the price and is certain; tolerance is a preference about what everybody else's
trades may do before you would rather revert. `src/components/limits.tsx` carries the tolerance and
the deadline for every write page, so the same control means the same thing on all four.

**Creating a market is permissionless, and that was checked rather than assumed.** `createPair` on
the deployed factory has no `msg.sender` check on either chain — `eth_call` from an unrelated
address returns an address on 7411 and on 7412 — so `/pools/new` renders a real button and says
"there is no allowlist, no fee and no owner check on this call". Only `setFeeTo` and
`setFeeToSetter` are gated, by the `feeToSetter` multisig `/contracts` prints. The three refusals
that *do* exist are pre-checked before any gas: identical addresses, the zero address, and
`PAIR_EXISTS` — and the last one links to the market that already exists rather than offering a
call that would revert. The page also says the thing that makes most visits unnecessary: depositing
into a pair that does not exist creates it in the same transaction, which is one signature instead
of two.

`LIQUIDITY_TERMS` in `src/lib/format.ts` is the list a reader sees before the first deposit, written
for the moment *before* the gas is spent. The protocol-fee item deliberately does not say "there is
no protocol fee": `feeTo()` is read live off the factory on the page beside it, because a claim in
prose about a value a multisig can change at any moment is a claim that goes stale silently.

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
- **No wallet, on a write page** → every number still renders and the button names what is missing.
  A page that hides a public reserve until you connect is asking for a permission it does not need.
- **A wallet holding nothing here** → "you hold none of this pool", *after* the sweep has said how
  many pools it checked. "No positions" from a read that gave up halfway is the same sentence.

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
| `render.test.ts` | Every route rendered against a stubbed chain, and the words read. The custody sentence, the not-deployed state, the "anyone may create one" line on a missing pool, the impostor warning. The four liquidity pages against a stubbed **wallet**: what was signed, what it was sent to, and that a settled deposit does not take its own confirmation off the screen. |
| `wallet.test.ts` | The calldata itself — selector, argument order, the native side arriving as `value` and not as an argument, the deadline being seconds and in the future, and an approval addressed to the token rather than to the router. |
| `dex.test.ts` | The ported arithmetic against the reference formulae and their invariants, including the first-deposit mint, the pro-rata burn, and that 100% of a balance is the balance bit for bit. |
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

- **No browser test loads this bundle.** `test/render.test.ts` drives the liquidity pages against a
  stubbed provider in `happy-dom`, and `wallet-extension/test/e2e/exchange.test.ts` drives seven
  real transactions — deposit, approve, withdraw and the rest — through the **real** extension
  against a **real** Hearth node. Neither is the same test: the extension e2e drives its own inline
  dapp, not this bundle. Joining them is blocked on a real constraint rather than on effort:
  `rpcUrl()` returns `null` on a local hostname by design, so a locally served bundle has no
  endpoint, and the only ways to give it one are a build-time variable or interception — the first
  is forbidden by `no-build-time-config.test.ts` and the `rules` job, the second by the rule that
  there is no `page.route` in `wallet-extension/test/e2e/` and never will be. Closing it honestly
  means serving this bundle behind a hostname the registry knows in CI, which is deploy work and
  not this repository's.
- **Approvals are two transactions, and there is no `permit`.** Hearth's ERC-20s are not uniformly
  EIP-2612, and a page that tried a signature first and fell back to an approval would ask for a
  signature that sometimes does nothing. Deliberate, and worth revisiting per token rather than in
  general.
- **The positions sweep is bounded at `PAIR_PAGE_LIMIT`** (50) like the pair list, for the same
  reason and with the same report — "Checked N of M pools" — because a position missing from an
  unbounded-looking list reads as "you have none".
- **A reload loses the transaction list.** Nothing is persisted; the explorer link is the durable
  record. See `src/lib/tx.ts` for why that is the trade rather than an omission.
- **No token list, and that is partly deliberate.** The swap form takes addresses and the pool list
  comes from the factory. A curated list would be a recommendation, and an exchange whose factory is
  permissionless cannot vouch for any market on it. A *searchable* list of what the factory has made
  is a different thing and is worth building.
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
