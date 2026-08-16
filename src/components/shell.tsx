/**
 * The chrome: the company bar, the surface navigation, the head block, the page, and the two
 * standing notices.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ── 2026-08-16: `CloudsForgeBar` IS MOUNTED HERE NOW, AND THIS RECORDS WHY THE OLD ARGUMENT LOST
 *
 * This file used to open with a long case AGAINST the bar. It ran: the bar always renders an
 * account control; `AccountMenu` shows a "Sign in" whenever `account.signedIn` is false
 * (`ui/packages/ui/src/index.tsx`); and on this surface that button is not a dead end but a
 * category error, because
 *
 *   - THIS SURFACE CALLS NO CLOUDSFORGE SERVICE AT ALL. There is no `micro-exchange`. Every number
 *     on every page comes from a public JSON-RPC endpoint over `eth_call`, and a CloudsForge
 *     session is not a credential any chain node has ever heard of. `lib/hosts.ts` still has no
 *     `apiBase()` for exactly that reason.
 *   - The identity that matters here is an ADDRESS IN THE READER'S OWN WALLET, which CloudsForge
 *     does not issue, cannot revoke and has no record of. Offering to sign somebody in beside the
 *     Connect button would suggest the two are alternatives. They are not: one of them can sign a
 *     swap and the other cannot.
 *
 * Both premises are still true and neither is deleted — they are why `lib/auth.tsx` gates nothing
 * and why no page in this bundle reads the session. What was wrong was the conclusion. The owner,
 * arriving at this surface the way a reader does:
 *
 *   "i tried url directly its open but it has no login bar on top"
 *
 * The bar is not an authorisation mechanism. It is the estate's chrome: the product switcher that
 * gets you to the other twelve surfaces, the network switcher, the CloudsForge home link, and the
 * handle of whoever is signed in. Every other surface has it. A page that drops it does not read as
 * "this page needs no account" — it reads as a page that fell off the estate, which is the precise
 * impression a stranger must not form about the one page in the ecosystem that handles their money.
 *
 * The fix for two identities that are easy to confuse is to show both and label them, not to hide
 * the one the rest of the estate is built on. The wallet control stays on the swap form, beside the
 * trade it authorises; the account control sits in the chrome, where every other surface's is.
 *
 * `test/shared-chrome.test.ts` now pins the presence and the reasoning, and `test/render.test.ts`
 * asserts that no route in this bundle is gated by the session it now reads.
 *
 * ── WHAT LEFT `xc-head` WHEN THE BAR ARRIVED ─────────────────────────────────────────────────
 *
 * The logo, the separator and the `NetworkSwitcher`. All three were in this header only because the
 * bar was absent — the bar carries a CloudsForge home link and the network switcher itself, and two
 * network switchers stacked vertically is not a smaller bug than none. What is left below the bar
 * is what is genuinely this surface's own: its name, its pages, and the block its numbers were read
 * at.
 *
 * ── THE HEAD BLOCK IS IN THE HEADER, AND THAT IS A DECISION ABOUT TRUST ───────────────────────
 *
 * Every number on this surface is as of some block. A page that shows a price without saying when
 * it was true is asking to be believed; one that names the block it read is checkable by anybody
 * with the explorer open. It sits in the chrome rather than on each page because it is a property
 * of the whole read, not of one panel — and because a reader deciding whether to trust a quote
 * should not have to hunt for it.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import {
  CloudsForgeBar,
  CloudsForgeFooter,
  CookieBanner,
  MainRegion,
  SkipLink,
  miningOnHub,
} from '@cloudsforge/ui'
import { applyHead, surfaceMeta } from '@cloudsforge/ui/seo'
import { useEffect, useState } from 'react'
import { surface } from '@cloudsforge/ui/surfaces'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../lib/auth.tsx'
import { useChain } from '../lib/chain.tsx'
import { formatBlock } from '../lib/format.ts'
import { hosts, placementIsKnown, PRODUCT, SURFACE_DESCRIPTION } from '../lib/hosts.ts'
import { NAV, ROUTES } from '../lib/routes.ts'
import { NotCustodiedNotice, UnregisteredNotice } from './notices.tsx'
import { setViewedNetwork, viewedNetwork, type ViewedNetwork } from '../lib/viewed.ts'

/**
 * The surface's own name, READ OFF THE REGISTRY rather than typed here.
 *
 * A header disagreeing with the name in the product switcher and in every footer on the estate is
 * exactly the drift a registry exists to stop.
 */
export const SURFACE_NAME = surface(PRODUCT).name

export function AppShell() {
  // The viewed network: in-tab memory, defaulting to the hostname's own (micro-org#459).
  // `setViewedNetwork` runs first in the handler below so the remounted tree reads the new value
  // on its very first render.
  const [viewed, setViewed] = useState<ViewedNetwork>(viewedNetwork())
  const { account, signIn, signOut } = useSession()
  const chain = useChain()
  const known = placementIsKnown()
  const estate = hosts()

  return (
    <>
      {/*
        First focusable element in the document. The shared one, which becomes VISIBLE on focus
        rather than staying off-screen — a skip link that stays hidden when focused is worse than
        none, because the reader activates it and cannot tell whether anything happened.
      */}
      <SkipLink>Skip to the page</SkipLink>

      <DocumentMeta />

      {/*
        THE ESTATE'S BAR. It carries the product switcher (Forge Exchange is an entry in it as of
        2026-08-16 — `inSwitcher: true` in `ui/packages/ui/src/surfaces.ts`, last in the
        customer-facing run), the CloudsForge home link, the browser-miner control, the reader's
        account, the network switcher, and the amber testnet band beneath itself.

        `networkSwitch` carries `onSelect`, which is what makes this surface VIEW the other network
        in place rather than teleport to a second deployment of itself. The choice re-points which
        chain node this page READS through `lib/viewed.ts` and `lib/rpc.ts`, and the `key` on the
        Outlet below remounts the tree so every read is actually made again. Nothing is stored —
        module memory, per tab.

        The band comes from the bar and follows the SELECTED network rather than the hostname,
        which is the property that makes viewing the other estate safe: testnet numbers under a
        mainnet address bar are never unmarked. It used to be mounted here directly because the bar
        was absent; two of them would not have been a smaller bug than none.
      */}
      <CloudsForgeBar
        current={PRODUCT}
        account={account}
        onSignIn={() => signIn()}
        onSignOut={signOut}
        mining={miningOnHub(estate.hub)}
        networkSwitch={{
          selected: viewed,
          onSelect: (n) => {
            setViewedNetwork(n)
            setViewed(n)
          },
        }}
      />
      <header className="xc-head">
        <div className="xc-head__inner">
          <span className="xc-head__name">{SURFACE_NAME}</span>
          <nav className="xc-nav" aria-label="Exchange pages">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                // `xc-nav__link--current` rather than a bare `is-current`: an unprefixed state
                // class is in the design system's namespace without being in the design system,
                // so it works until the day upstream defines one. test/tokens.test.ts holds the
                // prefix rule for every class this repository writes.
                className={({ isActive }) => `xc-nav__link${isActive ? ' xc-nav__link--current' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <span className="xc-head__spacer" />
          {/*
            THE BLOCK EVERY NUMBER ON THE PAGE IS AS OF.

            `aria-live` is deliberately absent. The head advances every few seconds on Hearth and a
            live region would announce a new number to a screen-reader user mid-sentence, forever.
            It is a fact to be looked up, not an event to be told about.
          */}
          <span className="xc-head__block" title="The block these numbers were read at">
            <span className="xc-head__block-label">Block</span>{' '}
            <span className="cf-num">{formatBlock(chain.head)}</span>
          </span>
        </div>
      </header>

      {/*
        `MainRegion` rather than a bare `<main>`: it carries `tabIndex={-1}` and owns the id the
        skip link composes its href from, so the two cannot disagree. Without the tabindex, following
        the link scrolls the page in Chrome and Safari and leaves focus on the link — so the reader's
        next Tab goes back into the header they asked to skip.
      */}
      <MainRegion className="xc-main">
        {!known && <UnregisteredNotice />}
        {/*
          ABOVE THE OUTLET, ON EVERY ROUTE. This is the sentence a stranger must not be able to
          miss, so it is not left to a page to remember to render — argued in `notices.tsx`.
        */}
        <NotCustodiedNotice />
        <Outlet key={viewed} />
      </MainRegion>

      {/*
        THE SHARED FOOTER, WITH THIS SURFACE'S ONE SENTENCE IN THE PLACE PROVIDED FOR IT.

        Every link in its columns is derived from the registry and its three legal links are
        micro-site's real routes — `/terms`, `/privacy` and `/risk` all resolve in `site/src/app.tsx`.

        `note` carries the claim that is load-bearing on this surface and it does NOT branch on
        anything read from the chain, because unlike the pool's payout claim it is true at every
        block: the contracts are permissionless, CloudsForge holds no balances, and nothing here is
        an offer. A footer is exactly where a claim survives its own truth, so the only claims that
        belong in one are the ones that cannot go stale.

        `account` IS passed as of 2026-08-16, and it used to be deliberately withheld: the note here
        read "nobody is ever signed in on this surface". Somebody can be now, and a footer that
        hides the operator tools from an operator the bar directly above it is greeting by name is
        the drift a shared component exists to prevent.
      */}
      <CloudsForgeFooter
        current={PRODUCT}
        account={account}
        note={
          <>
            Forge Exchange is a set of contracts on Hearth. CloudsForge deployed them and holds no
            balances and no keys over them. Anyone may create a market for any token, so the
            presence of a pool is not a recommendation of what is in it. Nothing on this page is an
            offer, a contract or a promise of return.
          </>
        }
      />

      {/*
        LAST IN THE DOCUMENT, AND THEREFORE LAST IN THE TAB ORDER. The banner is a dialog and is
        explicitly not modal, so a reader who came here to read a price can do that and answer about
        analytics afterwards. It renders nothing at all until it knows the reader has not already
        been asked, and nothing on an origin where analytics would not report anyway.
      */}
      <CookieBanner />
    </>
  )
}

/**
 * The document head, kept in step with the address.
 *
 * `surfaceMeta()` composes the title as `Page — Surface Name` from the registry, so the name is
 * read once and the suffix cannot drift.
 *
 * `description` is passed EXPLICITLY rather than derived. `descriptionFor()` would compose one from
 * the registry blurb plus the company line, and the blurb on the exchange row still describes the
 * product as planned rather than deployed — which was true when it was written and is the wrong
 * sentence to hand a search engine now. `test/seo.test.ts` compares the constant byte for byte with
 * `index.html`, so the copy a link-preview fetcher gets — those generally do not execute JavaScript
 * — cannot drift from the copy a crawler that does execute JavaScript ends up with.
 *
 * `robots` is likewise stated rather than derived. This surface's indexability is a decision it
 * makes about itself — an exchange nobody can find has no liquidity — not a side effect of two
 * registry flags somebody may set for another reason.
 *
 * The page title is read off `ROUTES`, the same declaration the navigation, the router and nginx's
 * enumerated locations all derive from, rather than typed a fifth time.
 */
function DocumentMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const segment = pathname.split('/')[1] ?? ''
    const label =
      segment === '' ? null : (ROUTES.find((route) => route.path === segment)?.label ?? null)
    applyHead(
      surfaceMeta(PRODUCT, {
        ...(label === null ? {} : { title: label }),
        description: SURFACE_DESCRIPTION,
        path: pathname,
        robots: 'index, follow, max-image-preview:large',
      }),
      // Read here rather than in the module, which is what keeps a hostname out of the artefact:
      // one bundle serves localhost, a preview deployment and the apex and composes correct
      // absolute URLs on each.
      typeof window === 'undefined' ? '' : window.location.origin,
    )
  }, [pathname])

  return null
}
