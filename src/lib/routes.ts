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

export interface AppRoute {
  /** The path segment, without a leading slash. The index route is the empty string. */
  readonly path: string
  /** What the sub-navigation calls it, or null when it is not a navigation destination. */
  readonly label: string | null
  /** True when the router genuinely has children beneath this path. Decides the nginx form. */
  readonly wildcard: boolean
}

/**
 * Three routes, and the argument for each one being separate rather than a section of the swap
 * page:
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
 *
 * There is deliberately no "add liquidity" page and no positions page. Both would need write paths
 * this surface has not built, and a menu entry that leads to an explanation of why the feature is
 * absent is worse than the feature being absent — it implies somebody decided against it rather
 * than that it has not been reached yet. §6 phase H of docs/ecosystem/39 scopes this surface to a
 * swap, a list and a proof.
 */
export const ROUTES: readonly AppRoute[] = [
  { path: '', label: 'Swap', wildcard: false },
  { path: 'pools', label: 'Pools', wildcard: true },
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
