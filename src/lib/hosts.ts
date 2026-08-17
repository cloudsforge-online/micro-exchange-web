/**
 * Where this app talks to, resolved at runtime from `window.location`, never from a build-time
 * constant.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS SURFACE HAS NO `apiBase()`, AND THE ABSENCE IS THE POINT.
 *
 * Every other frontend in the estate resolves a CloudsForge service to call. There is no
 * `micro-exchange` service and there is not going to be one: an AMM's whole state is four numbers
 * in a contract, and anything in front of them is a cache that is wrong between blocks. The one
 * address this bundle composes is the public JSON-RPC, and it is composed in `lib/rpc.ts` where the
 * argument for it belongs.
 *
 * What is left here is what every bundle needs: which surface this is, whether the address it is
 * being served from is one the registry knows, and where its siblings are.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { cloudsforgeHosts, type CloudsForgeHosts, type SurfaceKey } from '@cloudsforge/ui'

/**
 * The surface this application IS.
 *
 * `exchange`, registered as a `service` with **`inSwitcher: true`**, subdomain `exchange`, accent
 * `#dcde5e` and glyph `⇄`. **`markId: null`**, which is a decision rather than a gap and the same
 * one `explorer` and `pool` carry: the exchange is chain infrastructure and belongs to Forge
 * Network rather than being a product with a mark of its own. Nothing in this bundle renders a mark
 * and `test/brand-chrome.test.ts` asserts there is none to render.
 *
 * Its `devPort` is 5194 — this repository's own vite server, and the only entry in that registry
 * that names a dev server rather than a service. The standing rule is that a devPort is a fact
 * about the thing you CALL; here there is nothing to call, so the honest value is the one address
 * that answers for `exchange` on a developer's machine. It was 4150 while the row was a placeholder
 * for a plan, which was a reservation in the service block that nothing has ever bound.
 *
 * ── 2026-08-16: TWO OF THE THREE FACTS ABOVE CHANGED, AND THIS IS WHAT THEY WERE ─────────────
 *
 * This block said `inSwitcher: false` and accent `#b28e1e`, "the gold shared with `create` and
 * `pool`". Both were true and both are now wrong, on one report: "forge exchange is not available
 * in the product menu". The registry row moved to the end of the customer-facing run, `inSwitcher`
 * flipped, and the distinct-accent guard in `surfaces.test.ts` then DEMANDED a hue of its own —
 * which is exactly the trigger the old `tokens.css` comment predicted it would be. #dcde5e came out
 * of `ui/scripts/find_exchange_accent.mjs`, scored on separation from the two rows it touches.
 *
 * `kind: 'service'` rather than `'product'` still stands, and it is now doing MORE work rather than
 * less: the accent guard holds PRODUCTS to a strict bijection with `PRODUCT_ACCENTS`, and the
 * dE 30 adjacency gate iterates products only — so a `service` may be a switcher entry wearing a
 * hue that is not in the product set, which is what `explorer` and `nimbus` already do. A seventh
 * PRODUCT accent is a different and harder question, and `surfaces.ts` records that it has been
 * asked twice and answered no twice.
 */
export const PRODUCT: SurfaceKey = 'exchange'

/** The name reported to the observability ingest and shown in error copy. */
export const APP_NAME = 'exchange-web'

/**
 * The accent block this page's `<html>` names.
 *
 * `exchange` is a real selector in `ui/packages/ui/src/tokens.css` and has its OWN block as of
 * 2026-08-16, first among the non-product surfaces because it is first among them in the switcher.
 * It shared the gold block with `create` and `pool` until then, under a comment stating the
 * condition on which it would leave — becoming a switcher entry — which is what happened.
 *
 * Naming a product with no block would fall through to the company ember in complete silence, which
 * is the exact failure tokens.css calls out and the one `admin` had and `explorer` still has.
 * `test/brand-chrome.test.ts` asserts the selector this page names really exists upstream, which is
 * the check that catches a fall-through either way — and it is the check that would have caught the
 * split above going wrong.
 */
export const ACCENT_SURFACE = 'exchange'

/**
 * The sentence a search result carries, declared ONCE.
 *
 * It leads with what the exchange IS rather than with what it offers, because the first thing a
 * stranger has to understand about this page is that it is contracts on a chain and not a venue
 * with a desk behind it — that one fact decides whether everything else on the page is reassuring
 * or alarming. `test/seo.test.ts` compares this byte for byte with the description meta in
 * `index.html`, so the copy a link-preview fetcher gets — those generally do not execute JavaScript
 * — cannot drift from the copy a crawler that does execute JavaScript ends up with.
 */
export const SURFACE_DESCRIPTION =
  'Swap EMBER and Forge Create tokens against constant-product pools on Hearth. The contracts hold ' +
  'the liquidity, your own wallet signs every trade, and CloudsForge never holds your coins.'

/** The same four names `cloudsforgeHosts()` treats as development. Kept in step by test. */
export function isLocal(hostname: string): boolean {
  return (
    hostname === '' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local')
  )
}

/**
 * Whether this bundle is being served from an address the surface registry knows.
 *
 * `cloudsforgeHosts()` derives the apex by stripping a KNOWN first label. Served from an unknown
 * name — a preview deployment, somebody's tunnel — the whole name becomes the apex and every
 * CloudsForge URL derived from it resolves one level too deep. The app still renders, because every
 * route here is public and nothing on this surface is a security boundary; but it says so, once, in
 * the shell.
 *
 * IT MATTERS MORE HERE THAN ANYWHERE ELSE IN THE ESTATE, and that is why the notice is not
 * optional. `lib/rpc.ts` composes the chain endpoint from this same apex, so an unregistered
 * placement is a page that cannot read a chain at all — and the honest rendering of that is the
 * notice plus the unreachable state, not a spinner.
 */
export function isRegisteredPlacement(
  pageOrigin: string,
  hostname: string,
  estate: CloudsForgeHosts,
): boolean {
  if (isLocal(hostname)) return true
  if (!pageOrigin) return true
  try {
    return new URL(estate[PRODUCT]).origin === pageOrigin
  } catch {
    return false
  }
}

/** Every CloudsForge base URL, for the current environment. */
export function hosts(): CloudsForgeHosts {
  return cloudsforgeHosts()
}

/** The page origin, or a stable placeholder when there is no document (tests, prerender). */
export function pageOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

/** Whether the current address is one the registry knows. Read by the shell. */
export function placementIsKnown(): boolean {
  if (typeof window === 'undefined') return true
  return isRegisteredPlacement(window.location.origin, window.location.hostname, cloudsforgeHosts())
}

/**
 * A link to this chain's explorer, for an address or a transaction.
 *
 * The explorer is a registry surface, so its base comes off `cloudsforgeHosts()` like any other
 * sibling and follows the viewed network the same way. Composed here rather than in each page so
 * that the one place a path shape is written down is the one place it has to be corrected when
 * micro-explorer-web's routes change.
 */
export function explorerAddressUrl(estate: CloudsForgeHosts, address: string): string {
  return `${estate.explorer}/address/${encodeURIComponent(address)}`
}

export function explorerTxUrl(estate: CloudsForgeHosts, hash: string): string {
  return `${estate.explorer}/tx/${encodeURIComponent(hash)}`
}
