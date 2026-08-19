/**
 * What this shell takes from the design system, and what the one thing it used to withhold cost.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS FILE USED TO PIN AN ABSENCE. IT NOW PINS A MOUNT, AND THE HISTORY IS THE POINT.
 *
 * Until 2026-08-16 the assertion below was `!imported().includes('CloudsForgeBar')`, defended by a
 * long argument: the bar always renders an account control; there is no `micro-exchange`; every
 * number comes off a public JSON-RPC endpoint; and the identity that decides what a reader can do
 * is an address in their own wallet that CloudsForge did not issue and cannot revoke. Every one of
 * those premises is still true and none of them has been deleted from the shell.
 *
 * The conclusion was wrong, and the owner found it the way a reader would:
 *
 *   "i tried url directly its open but it has no login bar on top"
 *
 * The mistake was treating the bar as an authorisation mechanism. It is the estate's CHROME — the
 * product switcher, the network switcher, the CloudsForge home link, the handle of whoever is
 * signed in. A page that drops it does not read as "no account needed", it reads as a page that
 * fell off the estate, which is the worst impression the one money-handling surface can make.
 *
 * So the tests below hold three things, and the third is what stops this being a reversal of the
 * old argument rather than a correction of it:
 *
 *   1. the bar IS mounted, with the account and the network switch wired to real state;
 *   2. the network switcher still works IN PLACE — the reason it was mounted by hand was that the
 *      bar was absent, and handing it back to the bar must not turn it into a teleport;
 *   3. NOTHING IS GATED. The premises that kept the bar out were always premises about gating, and
 *      they survive intact: no route, no read and no panel on this surface consults a session.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FOOTER_LEGAL_LINKS } from '@cloudsforge/ui'
import { surface } from '@cloudsforge/ui/surfaces'
import { read, readSibling, stripComments } from './sources.ts'

const SHELL = stripComments(read('src/components/shell.tsx'), 'ts')
const SHELL_RAW = read('src/components/shell.tsx')

/** What the shell imports from the design system, as written. */
function imported(): string[] {
  const line = /import \{([^}]*)\} from '@cloudsforge\/ui'/.exec(SHELL)?.[1] ?? ''
  return line.split(',').map((name) => name.trim()).filter(Boolean)
}

test('the shell takes the shared chrome', () => {
  // Every one of these is a component the estate has already got wrong by hand somewhere. The skip
  // link becomes VISIBLE on focus — a hidden one is worse than none, because the reader activates
  // it and cannot tell whether anything happened. `MainRegion` is the target it skips to.
  // `CookieBanner` is the only place the analytics tag is ever injected, which is what keeps a
  // cookie from being set before consent — and on this surface the path being reported would name
  // a mining address.
  //
  // `CloudsForgeLogo` is NOT in this list any more, and its removal is not a regression: the bar
  // renders the logo itself, linked to the marketing site. The shell used to draw one by hand
  // because there was no bar to draw it, and two CloudsForge home links in one header is not a
  // smaller defect than none.
  for (const name of ['SkipLink', 'MainRegion', 'CookieBanner']) {
    assert.ok(imported().includes(name), `src/components/shell.tsx does not use ${name}`)
    assert.ok(SHELL.includes(`<${name}`), `${name} is imported and never mounted`)
  }
  assert.ok(
    !SHELL.includes('<CloudsForgeLogo'),
    'the shell draws its own logo beside the bar’s, which is two home links in one header',
  )
})

test('THE SHARED FOOTER IS MOUNTED, AND THERE IS NO LOCAL ONE LEFT BESIDE IT', () => {
  assert.ok(imported().includes('CloudsForgeFooter'))
  assert.ok(SHELL.includes('<CloudsForgeFooter'))
  // `current` is what marks this surface in its own footer and what the base line renders the name
  // and blurb from. Passed as the same constant the meta and the API base are derived from, so the
  // key is written once in this repository.
  assert.match(SHELL, /<CloudsForgeFooter[\s\S]*?current=\{PRODUCT\}/)
  // The local footer is GONE rather than hidden. A second `<footer>` in the document is two
  // landmarks with the same role, which a screen reader announces twice and neither one names.
  assert.ok(!/<footer\b/.test(SHELL), 'src/components/shell.tsx still writes a local <footer>')
  assert.ok(!/pl-foot/.test(SHELL), 'the local footer’s classes survive the local footer')
})

test('THE FOOTER’S LEGAL LINKS ARE MICRO-SITE ROUTES THAT REALLY EXIST', (t) => {
  // The footer composes these itself, from `FOOTER_LEGAL_LINKS` against `hosts.site` read INSIDE the
  // component. That is the arrangement the local footer existed to work around and it is the right
  // one — but it also means nothing in this repository would notice if a path stopped resolving.
  //
  // status-web recorded the estate paying for exactly that: two footer links broken since the day
  // they were written, because a hand-typed `/terms` never became the `/legal/terms` micro-site
  // actually served. So this reads micro-site's router and checks each path against it rather than
  // assuming the shared constant and the shared site agree.
  assert.ok(FOOTER_LEGAL_LINKS.length > 0)
  const app = readSibling('site/src/app.tsx')
  if (!app) return t.skip('micro-site is not checked out beside this repository')
  for (const link of FOOTER_LEGAL_LINKS) {
    const segment = link.path.replace(/^\//, '')
    assert.match(
      app,
      new RegExp(`path=["'](/)?${segment}["']`),
      `the footer links to ${link.path} and site/src/app.tsx has no route for it`,
    )
  }
})

test('THE ESTATE’S BAR IS MOUNTED, WITH A REAL ACCOUNT BEHIND IT', () => {
  assert.ok(
    imported().includes('CloudsForgeBar'),
    'src/components/shell.tsx does not mount CloudsForgeBar. This surface shipped without it once ' +
      'and the owner reported it: "it has no login bar on top". The bar is the estate’s chrome — ' +
      'the product switcher, the network switcher, the home link and the reader’s handle — not an ' +
      'authorisation mechanism, so "nothing here needs an account" is not a reason to drop it.',
  )
  assert.match(SHELL, /<CloudsForgeBar[\s\S]*?current=\{PRODUCT\}/)

  // A bar wired to a literal is a bar that renders a signed-out control to a signed-in reader
  // forever, which is indistinguishable from the defect this change fixed. The account comes from
  // the provider, and both handlers are passed: `onSignIn` alone leaves an operator unable to leave.
  assert.match(SHELL, /account=\{account\}/)
  assert.match(SHELL, /onSignIn=/)
  assert.match(SHELL, /onSignOut=/)
  assert.match(SHELL, /useSession\(\)/)

  // And the footer sees the same reader. It filters `adminOnly` surfaces on `account.roles`, so a
  // footer given nothing hides the operator tools from the operator the bar above it is greeting
  // by name — which is the drift a shared component exists to prevent.
  assert.match(SHELL, /<CloudsForgeFooter[\s\S]*?account=\{account\}/)
})

test('THE SURFACE IS IN THE PRODUCT MENU, WHICH IS A REGISTRY FACT AND NOT A LOCAL ONE', () => {
  // The bar renders the switcher from `SWITCHER_SURFACES`, so mounting it is only half the owner's
  // report. A row with `inSwitcher: false` produces a bar with no entry for the surface you are
  // standing on — which is exactly what "forge exchange is not available in the product menu"
  // described, and it is fixed upstream rather than here.
  const here = surface('exchange')
  // `subdomain: ''` + `basePath` since the apex consolidation. The switcher composes its entry from
  // `cloudsforgeHosts()`, which appends the mount to the origin, so a menu entry for this surface is
  // still an address that answers — see the "has no home" invariant in micro-ui's surfaces.test.ts,
  // which was rewritten in the same change because it asserted the subdomain as a proxy for that.
  assert.equal(here.subdomain, '')
  assert.equal(here.basePath, '/exchange')
  assert.equal(here.inSwitcher, true, 'the registry row is out of the switcher again')
  // Its own hue, not a borrowed one: the distinct-accent guard over SWITCHER_SURFACES is what
  // demanded it the moment the row went in, and `tokens.css` has a matching block.
  assert.equal(here.accent, '#d05870')
})

test('THE PREMISES THAT KEPT THE BAR OUT ARE STILL TRUE, AND STILL GATE NOTHING', () => {
  // The old argument was not wrong about the estate, it was wrong about menus. Its factual claims
  // are load-bearing in a different place now — they are why nothing on this surface is gated — so
  // they are checked here rather than deleted with the assertion they used to support.
  //
  // There is no `micro-exchange` and no service base to send a bearer to. If one ever appears, this
  // goes red on the day it does rather than on the day somebody notices in review.
  assert.doesNotMatch(
    stripComments(read('src/lib/hosts.ts'), 'ts'),
    /apiBase/,
    'src/lib/hosts.ts has grown an apiBase(). Every number on this surface is supposed to come ' +
      'from a chain node, and a service base is how a session quietly becomes load-bearing.',
  )
  // A BEARER MUST NEVER TRAVEL TO A CHAIN NODE. `lib/rpc.ts` composes the JSON-RPC address and
  // issues every eth_call; a public endpoint would ignore an authorization header, but sending one
  // would put a CloudsForge access token in the logs of something that is public by construction.
  const rpc = stripComments(read('src/lib/rpc.ts'), 'ts')
  assert.doesNotMatch(rpc, /authorization|Bearer|accessToken/i, 'lib/rpc.ts has grown a credential')
  assert.doesNotMatch(rpc, /session\.ts|auth\.tsx/, 'lib/rpc.ts imports the session')

  // The shell still states the wallet-versus-account distinction, because that is the confusion the
  // bar's account control can cause and the reader meets it in the shell rather than in this file.
  const header = SHELL_RAW.slice(0, SHELL_RAW.indexOf('import '))
  assert.match(header, /CloudsForgeBar/)
  assert.match(header, /no CloudsForge service/i)
  assert.match(header, /wallet/i)
  // And the reasoning must not be borrowed from the console it was first written for. micro-pool's
  // version of this argument turned on a bearer token and a mining address, neither of which exists
  // here; a reason a reader can disprove in ten seconds gets the decision reversed for a bad cause.
  assert.doesNotMatch(
    header,
    /mining address|micro-pool/,
    'the shell argues about the bar on micro-pool’s grounds; this surface has neither',
  )
})

test('THE NETWORK SWITCH STILL VIEWS IN PLACE, NOW THAT THE BAR CARRIES IT', () => {
  // The switcher was mounted by hand ONLY because the bar was absent (micro-org#459). Handing it
  // back must not turn it into a teleport to a second deployment: `onSelect` is what makes the bar
  // re-point this page's reads instead of navigating, and without it the bar falls back to an
  // `elsewhere` link. Nothing in this repository would notice the difference except this test.
  assert.match(SHELL, /networkSwitch=\{\{/)
  assert.match(SHELL, /selected: viewed/)
  assert.match(SHELL, /onSelect: \(n\) =>/)
  assert.ok(
    !SHELL.includes('<NetworkSwitcher'),
    'the shell mounts a second network switcher beside the bar’s',
  )

  // And the choice actually re-points the reads. `viewedNetwork` is what `lib/rpc.ts` composes the
  // endpoint from, and the `key` on the outlet is what makes the tree read again — a switcher that
  // set state without remounting would relabel the page while leaving the other chain's numbers on
  // it, which is the worst of the three possible outcomes.
  assert.match(SHELL, /setViewedNetwork\(/)
  assert.match(SHELL, /<Outlet key=\{viewed\}/)

  // The amber band comes from the bar now and follows the SELECTED network, not the hostname it was
  // served from. Mainnet chrome over testnet numbers is the failure this arrangement exists to
  // prevent, and the bar reads `networkSwitch.selected` to render it — which the assertions above
  // are what keep pointed at the same state.
  assert.ok(
    !SHELL.includes('<TestnetBand'),
    'the shell mounts a second testnet band beside the bar’s',
  )
})

test('every estate link in the shell is composed by the REGISTRY, through this repository’s wrapper', () => {
  // There is no local correction any more — `hosts()` is a one-line pass to `cloudsforgeHosts()`.
  // The indirection stays because it is the seam a test can stub and because the day this surface
  // needs a placement rule again, there is one place for it. Importing the registry function
  // directly here would spread that decision one import at a time.
  assert.ok(!imported().includes('cloudsforgeHosts'))
  assert.match(SHELL, /import \{[^}]*\bhosts\b[^}]*\} from '\.\.\/lib\/hosts\.ts'/)
})

test('THE SHELL SAYS SO WHEN IT CANNOT WORK OUT WHERE IT IS', () => {
  // A page whose every outbound link is silently one level too deep is worse than a page that
  // admits it does not know where it is. The registry row fixed the ordinary case; a preview
  // hostname the registry cannot place is still unplaceable, and the footer's own links go with it.
  assert.ok(SHELL.includes('placementIsKnown'))
  assert.ok(SHELL.includes('<UnregisteredNotice'))
})

test('the standing custody notice is in the SHELL, above the outlet', () => {
  // So there is no route a stranger can arrive at without meeting it, including one that does not
  // exist. A page-level notice is a notice somebody forgets to add to the fourth page — and on this
  // surface the sentence being forgotten is the one that says CloudsForge is not holding the money.
  const outlet = SHELL.indexOf('<Outlet')
  const notice = SHELL.indexOf('<NotCustodiedNotice')
  assert.ok(notice > 0 && outlet > 0 && notice < outlet, 'the custody notice is not above the outlet')
})
