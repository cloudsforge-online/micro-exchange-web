/**
 * The route table, as data.
 *
 * This module imports NOTHING. Three separate things have to agree about which addresses this app
 * answers — this table, `src/app.tsx`, and the enumerated `location` blocks in `nginx.conf` — and
 * `test/routes.test.ts` reads all three as text and cross-checks them. It can only do that if this
 * file is readable without a bundler.
 *
 * The nginx side is the half that fails quietly. `try_files $uri /index.html` answers 200 for every
 * address in existence, including the ones this router does not know, so a typo in a link becomes a
 * blank page with a successful status and a crawler indexes every one of them. The routes are
 * therefore enumerated there, and `error_page 404 /index.html` is what serves the shell UNDER the
 * real status.
 */

/**
 * ── WHERE THIS BUNDLE IS MOUNTED, AND WHY THE TWO KINDS OF PATH BELOW ARE NOT THE SAME KIND ──────
 *
 * This desk used to be a hostname. It is now a FOLDER on the apex: `/exchange`, wave 2 of the
 * consolidation argued in micro-deploy `docs/apex-consolidation.md`. The registry row says the same
 * thing in one line — `subdomain: ''`, `basePath: '/exchange'` — and everything the estate composes
 * about this surface comes from there.
 *
 * Inside this repository the move splits every address into two, and getting the pair the wrong way
 * round is the failure mode of the whole change:
 *
 *   A ROUTER PATH is what `react-router` matches, and it is relative to the mount. `/pools/0x…`.
 *     Every `<Link to>`, every `<Route path>`, `NAV`, `poolPath()`, `swapPath()`, `POSITIONS_PATH`.
 *     `basename` in `src/app.tsx` puts the prefix back on the way out, so a router path that
 *     already carries it renders `/exchange/exchange/pools/0x…`.
 *
 *   A PUBLIC PATH is what a reader's address bar shows, what gets pasted into a chat window, and
 *     what a crawler is handed. `/exchange/pools/0x…`. Every `<loc>` in the sitemap and every
 *     `location` in `nginx.conf`.
 *
 * `publicPath()` is the one crossing, and it is the only place `BASE` is concatenated.
 *
 * EVERY EXPORTED HELPER BELOW RETURNS A ROUTER PATH, and that is deliberate rather than incidental:
 * a pair address pasted into a conversation is this surface's most-used link, it is produced by
 * `poolPath()`, and it is handed to `<Link to>`. Making the helpers public-path would have put the
 * prefix on twice everywhere it matters and nowhere else.
 */
export const BASE = '/exchange'

/**
 * A router path as a public one.
 *
 * The index is `/exchange` rather than `/exchange/` — no trailing slash anywhere on this surface,
 * so the sitemap entry and the `location` in `nginx.conf` are one address rather than two with a
 * redirect between them.
 */
export function publicPath(path: string): string {
  return path === '/' ? BASE : `${BASE}${path}`
}

export interface AppRoute {
  /** The path segment, without a leading slash. The index route is the empty string. */
  readonly path: string
  /** What the sub-navigation calls it, or null when it is not a navigation destination. */
  readonly label: string | null
  /** True when the router genuinely has children beneath this path. Decides the nginx form. */
  readonly wildcard: boolean
}

/**
 * Four top-level routes, and the argument for each one being separate rather than a section of the
 * swap page:
 *
 *   `''`          — the swap. The one page a stranger needs, and the only one that asks for a
 *                   signature. Everything on it is about one trade against one pool.
 *   `pools`       — every market the factory has made, with its reserves and its invariant. This
 *                   is the page that answers "is there a market for X", which the swap form
 *                   cannot: a form that has already been given two tokens is the wrong place to
 *                   find out which two exist.
 *   `contracts`   — the addresses, and the two checks the plan calls traps, RE-RUN IN THE READER'S
 *                   BROWSER. It has an address of its own because it is the page somebody links to
 *                   when they are asked to prove the thing is real, and a section of a swap form
 *                   is not linkable.
 *   `receipts`    — the Forge Receipts, which are the one thing on this surface that is somebody's
 *                   PROMISE rather than somebody's code. It is separate from `contracts` for the
 *                   reason it exists at all: `/contracts` proves that nobody can take your coins,
 *                   and a receipt is the case where somebody already has them. Filing the two
 *                   under one heading would let the second borrow the first's assurances. It is
 *                   also the address a reader is sent to from the main site and from the network
 *                   pages, on either network, and each has to be linkable on its own.
 *
 * ── THE LIQUIDITY PAGES ARE CHILDREN OF `pools`, NOT A FIFTH ENTRY ───────────────────────────
 *
 * This block used to say there was deliberately no add-liquidity page and no positions page,
 * because both needed write paths the surface had not built. micro-org#497 built them, and they
 * live UNDER `pools` rather than beside it:
 *
 *   `pools/positions`     — what the connected address holds, across every market on the chain.
 *   `pools/new`           — create a market. The factory is permissionless, checked against the
 *                           deployed contract on both chains rather than assumed.
 *   `pools/:pair/add`     — put two tokens in.
 *   `pools/:pair/remove`  — take them back out.
 *
 * Under `pools` because that is what they are about — a reader looking for their own liquidity is
 * looking at the market list, not at a separate product — and because `pools` is already
 * `wildcard: true`, so the router mounts them, nginx already serves them, and this table does not
 * change. `test/routes.test.ts` checks only the FIRST segment of each mounted route against this
 * list, which is what makes that true rather than a coincidence.
 *
 * `positions` and `new` cannot collide with `:pair`: a pair segment is a twenty-byte hex address
 * and `PoolPage` rejects anything that is not one, and react-router ranks a static segment above a
 * dynamic one regardless. The two static children are still declared FIRST in `src/app.tsx`, so the
 * ordering is visible to somebody reading it rather than resting on a ranking rule.
 *
 * §6 phase H of docs/ecosystem/39 scoped this surface to a swap, a list and a proof; the write half
 * is #497. `receipts` is phase G's half of the same document, which §7 requires to have a surface
 * of its own before anything is issued to anybody.
 */
export const ROUTES: readonly AppRoute[] = [
  { path: '', label: 'Swap', wildcard: false },
  { path: 'pools', label: 'Pools', wildcard: true },
  { path: 'receipts', label: 'Receipts', wildcard: false },
  { path: 'contracts', label: 'Contracts', wildcard: false },
]

/** The sub-navigation, in order. Derived, so a route cannot be added without deciding this. */
export const NAV: readonly { readonly to: string; readonly label: string }[] = ROUTES.filter(
  (route): route is AppRoute & { label: string } => route.label !== null,
).map((route) => ({ to: `/${route.path}`, label: route.label }))

/** Every non-index path, for the nginx cross-check. */
export const NON_INDEX_PATHS: readonly string[] = ROUTES.filter((route) => route.path !== '').map(
  (route) => route.path,
)

/**
 * One pool's address.
 *
 * The pair address is its own segment rather than a query parameter because a link to a market has
 * to survive being pasted into a chat window, and because a pair address is the market's real
 * identity on chain — a link built from two token symbols would start meaning something different
 * the day two tokens shared a symbol, which on a permissionless token factory is a matter of when.
 */
export function poolPath(pair: string): string {
  return `/pools/${encodeURIComponent(pair.toLowerCase())}`
}

/**
 * The two write pages for one pool, and the two that are not about a particular pool.
 *
 * Built from `poolPath` rather than from their own template, so that the encoding and the
 * lower-casing are decided in exactly one place. A pair address that reached a link with its
 * checksum casing intact would still work — react-router does not care — but it would produce two
 * different URLs for one market, which is two entries in a reader's history and two things a
 * crawler indexes.
 */
export function addLiquidityPath(pair: string): string {
  return `${poolPath(pair)}/add`
}

export function removeLiquidityPath(pair: string): string {
  return `${poolPath(pair)}/remove`
}

/** What the connected wallet holds. A constant, because it takes no argument and never will. */
export const POSITIONS_PATH = '/pools/positions'

/** Creating a market. Static, and it cannot be mistaken for a pair address. */
export const NEW_POOL_PATH = '/pools/new'

/**
 * The swap page, pre-filled with a pair.
 *
 * A QUERY STRING HERE, DELIBERATELY, WHERE `poolPath` USES A SEGMENT. The two carry different
 * kinds of thing: `/pools/0x…` identifies a market, and this identifies a *draft* — which tokens
 * the form should start on. A draft belongs in the query because it is not part of the resource's
 * identity, and because a reader who then changes the tokens should not accumulate history entries
 * for a form they are still filling in.
 */
export function swapPath(from: string, to: string): string {
  const params = new URLSearchParams({ from: from.toLowerCase(), to: to.toLowerCase() })
  return `/?${params.toString()}`
}
