/**
 * What this shell takes from the design system, and the one thing it deliberately does not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * ONE ABSENCE, AND IT IS PINNED TO A PRODUCT ARGUMENT RATHER THAN TO A GAP.
 *
 * `CloudsForgeBar` is out. The distinction this file exists to hold is between an absence caused by
 * something MISSING — which the day it lands should turn into a mount, and until then is a debt —
 * and an absence that is a decision, which no amount of upstream work should reverse. This one is
 * the second kind, and the registry is not the reason: `surface('exchange')` resolves, which is how
 * `CloudsForgeFooter` is mounted below and how its three legal links compose against micro-site.
 *
 * The bar always renders an account control, and `AccountMenu` shows "Sign in" whenever the reader
 * is not signed in. On this surface there is nothing behind that button: there is no
 * `micro-exchange`, every number comes off a public JSON-RPC endpoint, and the identity that decides
 * what a reader can do is an address in their own wallet that CloudsForge did not issue and cannot
 * revoke. So the test below pins THAT reason, in the shell where a reader will actually meet it, and
 * checks it is still true — an absence defended by a claim that has quietly stopped holding is an
 * absence nobody can defend.
 *
 * What the absence must NOT take with it is the network switcher. The bar is what normally carries
 * it, and losing it here would leave this the one surface in the estate that cannot be read on the
 * other network at all. It is mounted directly, and that is asserted too.
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
  for (const name of ['SkipLink', 'MainRegion', 'CookieBanner', 'CloudsForgeLogo']) {
    assert.ok(imported().includes(name), `src/components/shell.tsx does not use ${name}`)
    assert.ok(SHELL.includes(`<${name}`), `${name} is imported and never mounted`)
  }
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

test('THE BAR IS OUT ON PRODUCT GROUNDS, AND THE SHELL STATES THEM WITHOUT CITING THE REGISTRY', () => {
  assert.ok(
    !imported().includes('CloudsForgeBar'),
    'src/components/shell.tsx mounts CloudsForgeBar. The registry row is not the question — it ' +
      'landed and the footer went in on the strength of it. The bar always renders an account ' +
      'control, and this surface calls no CloudsForge service at all: every number on it comes ' +
      'from a public JSON-RPC endpoint over eth_call, and the identity that decides what a reader ' +
      'can do here is an address in their own wallet. A "Sign in" beside the Connect button reads ' +
      'as an alternative to it. It is not one — only one of the two can sign a swap.',
  )

  // The reason has to survive in the file, not only in this test — a reader deciding whether to
  // mount the bar reads the shell, and the argument is the whole of what stops them. Each of these
  // claims is checkable against this repository rather than being a taste: there is no
  // `micro-exchange` to hold a session, and `lib/hosts.ts` has no `apiBase()` to send one to.
  const header = SHELL_RAW.slice(0, SHELL_RAW.indexOf('import '))
  assert.match(header, /CloudsForgeBar/)
  assert.match(header, /no CloudsForge service/i)
  assert.match(header, /category error/i)
  assert.match(header, /wallet/i)
  // And the claim is TRUE, not merely written down. The bar's absence rests on this surface having
  // no service behind it; a `apiBase()` appearing in hosts.ts is the day the argument stops holding
  // and the day this test should go red, rather than the day somebody notices in review.
  assert.doesNotMatch(
    stripComments(read('src/lib/hosts.ts'), 'ts'),
    /apiBase/,
    'src/lib/hosts.ts has grown an apiBase(). The shell keeps CloudsForgeBar out on the grounds ' +
      'that this surface calls no CloudsForge service; that ground has just moved.',
  )
  // And the argument must not be borrowed from the console it was written for. micro-pool's version
  // of this absence turned on a bearer token and a mining address, neither of which exists here; a
  // reason a reader can disprove in ten seconds gets the decision reversed for the wrong cause.
  assert.ok(surface('exchange').subdomain === 'exchange')
  assert.doesNotMatch(
    header,
    /mining address|micro-pool/,
    'the shell argues the bar out on micro-pool’s grounds; this surface has neither',
  )
})

test('THE BAR BEING OUT DOES NOT TAKE THE NETWORK SWITCHER WITH IT', () => {
  // The claims that keep `CloudsForgeBar` out are all claims about the ACCOUNT CONTROL it renders.
  // None of them reaches `NetworkSwitcher`, which asks for no session and renders no account — but
  // the bar is what normally carries it, so dropping the bar without mounting the switcher directly
  // would leave this one surface unable to be read on the other network at all (micro-org#459).
  // Without this test the next reader tidying the shell reads "the shared chrome is out on product
  // grounds" and takes the switcher out with it.
  assert.ok(imported().includes('NetworkSwitcher'), 'the shell does not mount the network switcher')
  assert.ok(SHELL.includes('<NetworkSwitcher'))

  // And the choice actually re-points the reads. `viewedNetwork` is what `lib/rpc.ts` composes the
  // endpoint from, and the `key` on the outlet is what makes the tree read again — a switcher that
  // set state without remounting would relabel the page while leaving the other chain's numbers on
  // it, which is the worst of the three possible outcomes.
  assert.match(SHELL, /setViewedNetwork\(/)
  assert.match(SHELL, /<Outlet key=\{viewed\}/)

  // The amber band follows the SELECTED network, not the hostname it was served from. Mainnet
  // chrome over testnet numbers is the failure this whole arrangement exists to prevent.
  assert.match(SHELL, /<TestnetBand network=\{viewed\}/)
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
