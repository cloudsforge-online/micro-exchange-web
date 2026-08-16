/**
 * The chrome: the logo, the surface name, the navigation, the network switcher, the head block, the
 * page, and the two standing notices.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * `CloudsForgeBar` IS NOT MOUNTED HERE, AND THE REASON IS ABOUT THIS PRODUCT RATHER THAN ABOUT THE
 * REGISTRY.
 *
 * The bar always renders an account control, and `AccountMenu` shows a "Sign in" button whenever
 * `account.signedIn` is false (`ui/packages/ui/src/index.tsx`). On this surface that button is not
 * a dead end, it is a category error — and a more serious one than it was on the pool console:
 *
 *   - THIS SURFACE CALLS NO CLOUDSFORGE SERVICE AT ALL. There is no `micro-exchange`. Every number
 *     on every page comes from a public JSON-RPC endpoint over `eth_call`, and a CloudsForge
 *     session is not a credential any chain node has ever heard of. `lib/hosts.ts` has no
 *     `apiBase()` for the same reason.
 *   - The identity that matters here is an ADDRESS IN THE READER'S OWN WALLET, which CloudsForge
 *     does not issue, cannot revoke and has no record of. Offering to sign somebody in beside the
 *     Connect button would suggest the two are alternatives. They are not: one of them can sign a
 *     swap and the other cannot.
 *
 * So a "Sign in" here would suggest that signing in would show the reader something. It would not.
 * `test/shared-chrome.test.ts` pins that reason and `test/render.test.ts` asserts no page here
 * offers the words at all.
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
  CloudsForgeFooter,
  CloudsForgeLogo,
  CookieBanner,
  MainRegion,
  NetworkSwitcher,
  SkipLink,
  TestnetBand,
} from '@cloudsforge/ui'
import { applyHead, surfaceMeta } from '@cloudsforge/ui/seo'
import { useEffect, useState } from 'react'
import { surface } from '@cloudsforge/ui/surfaces'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
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
        The amber band, mounted directly for the same reason the switcher below is. It follows the
        SELECTED network rather than the hostname, which is the property that makes viewing the
        other estate safe: testnet numbers under a mainnet address bar are never unmarked.
      */}
      <TestnetBand network={viewed} />
      <header className="xc-head">
        <div className="xc-head__inner">
          <a className="xc-head__logo" href={estate.site} aria-label="CloudsForge home">
            <CloudsForgeLogo size={20} />
          </a>
          <span className="xc-head__sep" aria-hidden="true" />
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
          {/*
            THE NETWORK SWITCHER, MOUNTED DIRECTLY, FOR THE SAME REASON THIS HEADER IS.

            `CloudsForgeBar` is out of this surface on the grounds set out at the top of this file,
            and it is the bar that normally carries this control — so leaving it to the bar would
            have meant this surface alone could not be read on the other network (micro-org#459).
            It hides itself off-registry, so a local stack sees nothing.

            `onSelect` rather than a navigation: the choice re-points which chain node this page
            READS through `lib/viewed.ts` and `lib/rpc.ts`, and the `key` on the Outlet below
            remounts the tree so every read is actually made again. Nothing is stored — module
            memory, per tab.
          */}
          <NetworkSwitcher
            selected={viewed}
            onSelect={(n) => {
              setViewedNetwork(n)
              setViewed(n)
            }}
          />
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

        No `account` is passed, which hides every `adminOnly` surface. That is the correct default
        here and not an omission: nobody is ever signed in on this surface — see the header.
      */}
      <CloudsForgeFooter
        current={PRODUCT}
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
