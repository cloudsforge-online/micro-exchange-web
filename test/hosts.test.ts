/**
 * Where this bundle thinks it is, and — mostly — what it does NOT talk to.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE LARGEST THING THIS FILE CHECKS IS AN ABSENCE.
 *
 * Every other frontend in the estate resolves a CloudsForge service. `src/lib/hosts.ts` here has no
 * `apiBase()`, no `resolveApiBase()` and no dev port for a service, because there is no
 * `micro-exchange` and there is not going to be one: an AMM's whole state is four numbers in a pair
 * contract, and anything standing in front of them is a cache that is wrong between blocks.
 *
 * An absence with no test on it is a decision that has already been forgotten. So the shape of this
 * module is asserted directly — the day somebody adds an API base here, this file is what says why
 * it does not belong, in the place they are already looking.
 *
 * The one remote address this bundle composes is the public JSON-RPC, and it is composed in
 * `src/lib/rpc.ts` where the argument for it lives. `test/viewed.test.ts` pins it.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Window } from 'happy-dom'
import { KNOWN_SUBS, SURFACES, surface } from '@cloudsforge/ui/surfaces'
import {
  ACCENT_SURFACE,
  APP_NAME,
  explorerAddressUrl,
  explorerTxUrl,
  hosts,
  isLocal,
  placementIsKnown,
  PRODUCT,
  SURFACE_DESCRIPTION,
} from '../src/lib/hosts.ts'
import { read, stripComments } from './sources.ts'

/**
 * Run `fn` as though the bundle were being served from `url`.
 *
 * A window rather than a hand-built map of estate URLs, deliberately. The functions under test read
 * `window.location` and hand it to `cloudsforgeHosts()`, and the defect this pattern exists to catch
 * — every sibling address resolved one level too deep, which pool-web shipped for a fortnight —
 * lived entirely in that composition. A test that passed in its OWN idea of what the registry
 * composes would have agreed with the bug it was written to catch, which is the failure mode of
 * every fixture that restates the thing it is checking.
 */
function atPage<T>(url: string, fn: () => T): T {
  const win = new Window({ url })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true })
  try {
    return fn()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete (globalThis as { window?: unknown }).window
  }
}

test('THE REGISTRY SAYS THIS SURFACE SERVES A PAGE, WHICH IS WHAT MADE THIS REPOSITORY LEGAL', () => {
  const exchange = surface(PRODUCT)

  // ── IT IS A PATH ON THE APEX, AND `KNOWN_SUBS` NO LONGER HOLDS `exchange` ──────────────────────
  //
  // This asserted `subdomain === 'exchange'` and `KNOWN_SUBS.has('exchange')` until 2026-08-19. Both
  // are now false, and the SECOND one is the consequence worth asserting rather than deleting:
  // `KNOWN_SUBS` is what `cloudsforgeHosts()` strips to find the apex, so with `exchange` gone from
  // it a bundle served at `exchange.cloudsforge.online` would treat that whole name as its apex and
  // compose every sibling one level too deep. That is CORRECT — nothing is served there any more,
  // the hostname is a 301 — and it is asserted so that the day somebody puts a bundle back on that
  // hostname, this fails and says why.
  assert.equal(exchange.subdomain, '')
  assert.equal(exchange.basePath, '/exchange')
  assert.equal(KNOWN_SUBS.has('exchange'), false)

  // `servesUi` was FALSE for the whole time this was a plan, and the row said why in full: nothing
  // answered the hostname, so a `true` would have put a dead link in every footer in the estate. It
  // is what puts the exchange in the shared footer's columns at all, and it flipped on the
  // measurement — in one commit with the gateway router, the compose service and the
  // `EXPECTED_UNROUTED` deletion in `deploy/scripts/surface-routes.py`, which checks the claim from
  // both directions. This assertion is the frontend's half of that.
  assert.equal(exchange.servesUi, true)

  // `viewsAnyNetwork` is not decoration either: `deploy/scripts/surface-routes.py` check 10 derives
  // the CORS viewer list from this flag and REQUIRES the named repository to contain
  // `src/lib/viewed.ts`. It does — that is the module `lib/rpc.ts` reads to decide which chain to
  // ask — so the gateway grants this origin the testnet API and the flag is falsifiable rather than
  // aspirational.
  assert.equal(exchange.viewsAnyNetwork, true)

  // `inSwitcher` was FALSE, on this argument, which is preserved because it is the argument that
  // lost: "the switcher is what a signed-in customer opens to choose between products they have an
  // account on, and THERE IS NO ACCOUNT HERE: every read is an anonymous `eth_call` and every write
  // is signed by the reader's own wallet. The exchange is somewhere people are sent — from the
  // footer, from Forge Create, from a token's page."
  //
  // Every clause of that is still true and the conclusion was still wrong, because the switcher is
  // not a list of things you have an account on — `explorer` and `network` are in it and neither
  // has ever had one. It is the estate's map. A product missing from it is a product a reader
  // cannot get to without already knowing its address, which is exactly how this was reported:
  //
  //   "forge exchange is not available in the product menu"
  //
  // Flipping this DEMANDED an accent of its own, because `surfaces.test.ts` holds every switcher
  // entry to a distinct hue — #d05870, from `ui/scripts/find_exchange_accent.mjs`. The row sits
  // last in the customer-facing run, and `test/shared-chrome.test.ts` holds the pair from the
  // frontend's side. It is the sweep's SECOND answer: the first, a lime, cleared every separation
  // gate and then failed axe on micro-site, which sets type in the raw accent.
  assert.equal(exchange.inSwitcher, true)
  assert.equal(exchange.accent, '#d05870')

  // No mark of its own, which is why public/ borrows CloudsForge's chrome. See brand-chrome.test.
  assert.equal(exchange.markId, null)
})

test('THE DEV PORT IS THIS BUNDLE’S OWN SERVER, BECAUSE THERE IS NO SERVICE TO NAME', () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // The registry's standing rule is that a devPort is A FACT ABOUT THE THING YOU CALL, restated
  // three times in surfaces.ts because three rows got it wrong (foresight carried beacon's 4011,
  // emberkin carried 3014 while binding 4100, admin carried 3002 while admin-api binds 4014).
  //
  // Here there is nothing to call. The row carried 4150 while it was a placeholder for a plan — a
  // reservation in the 4000 service block that nothing has ever bound — so a local checkout linking
  // to Forge Exchange composed `http://localhost:4150` and reached nothing. 5194 is the port THIS
  // repository's vite server binds, which is the only address that answers for `exchange` on a
  // developer's machine and therefore the only true thing that number can be.
  //
  // Read off both files rather than written down here, so the pair cannot drift: `pnpm dev` binds
  // what vite.config.ts says, and every sibling frontend links to what the registry says.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const vite = stripComments(read('vite.config.ts'), 'ts')
  const declared = /server:\s*\{\s*port:\s*(\d+)\s*\}/.exec(vite)?.[1]
  assert.equal(
    Number(declared),
    surface(PRODUCT).devPort,
    'vite.config.ts and the surface registry disagree about the port this bundle serves on, so a ' +
      'local link to Forge Exchange resolves to a port nothing is listening on',
  )
  // And the preview server agrees with the dev server, because `pnpm preview` is what a reviewer
  // opens to look at a production build and a second number there is a second thing to get wrong.
  assert.match(vite, /preview:\s*\{\s*port:\s*5194\s*\}/)
})

test('THIS SURFACE DOES NOT CALL A CLOUDSFORGE SERVICE, AND SAYS SO BY HAVING NO WAY TO', () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // The absence, asserted where somebody about to undo it will read it.
  //
  // Adding an `apiBase()` here would not break a test that checks behaviour, because at first it
  // would have no caller. It would break the claim: the page tells a reader their browser talks to
  // the chain and to nothing else, `/contracts` re-derives the CREATE2 addresses locally so nothing
  // served from `exchange.<apex>` has to be trusted, and nginx.conf proxies nothing so that the
  // claim is true at the network layer too. A helper that resolves a CloudsForge origin is the
  // first step of walking that back, and it is the step nobody argues about.
  //
  // Comments are stripped first, because the module ARGUES for the absence at length and a grep
  // over the raw bytes would match the argument and fail a correct file — see `test/sources.ts`.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const code = stripComments(read('src/lib/hosts.ts'), 'ts')
  for (const forbidden of [/apiBase/, /API_DEV_PORT/, /['"`]\/v1/, /fetch\s*\(/]) {
    assert.doesNotMatch(
      code,
      forbidden,
      'src/lib/hosts.ts has grown a way to call a CloudsForge service; there is no micro-exchange, ' +
        'and the surface’s whole argument is that there does not need to be one',
    )
  }

  // And the rule that makes every branch below meaningful: nothing here holds a literal estate
  // address, so an image built once is correct on localhost, on testnet and on mainnet. The
  // `rules` CI job greps for the same names without stripping comments, which is why this module
  // never spells one out even to argue against it.
  assert.ok(!/cloudsforge\.online/.test(code), 'src/lib/hosts.ts must not contain an estate hostname')
  assert.ok(!/import\.meta\.env/.test(code), 'src/lib/hosts.ts must not read build-time configuration')
})

test('the app name and the accent are this surface’s own', () => {
  assert.equal(APP_NAME, 'exchange-web')
  // `exchange` is a real block in tokens.css — it shares the gold with `create` and `pool`. Naming
  // a product with no block falls through to the company ember in complete silence, which is the
  // defect `admin` had and `explorer` still has; `test/brand-chrome.test.ts` reads the CSS and
  // proves the selector this page names exists upstream.
  assert.ok(SURFACES.some((s) => s.key === ACCENT_SURFACE))
})

test('the description leads with what the exchange IS, not with what it offers', () => {
  // The first fact a stranger needs is that this is contracts on a chain rather than a venue with a
  // desk behind it — that one fact decides whether everything else on the page reads as reassuring
  // or as alarming. `test/seo.test.ts` compares this byte for byte with index.html; this checks the
  // sentence itself, which that comparison cannot.
  assert.ok(SURFACE_DESCRIPTION.includes('never holds your coins'))
  assert.ok(SURFACE_DESCRIPTION.includes('your own wallet signs'))
  // No hostname, for the same reason nothing else in src/ carries one.
  assert.ok(!/cloudsforge\.online/.test(SURFACE_DESCRIPTION))
})

test('the four development hostnames are the same four the design system treats as local', () => {
  for (const local of ['', 'localhost', '127.0.0.1', 'dev.local', 'exchange.local']) {
    assert.equal(isLocal(local), true, local)
  }
  for (const remote of ['exchange.cloudsforge.online', 'localhost.cloudsforge.online', 'notlocal']) {
    assert.equal(isLocal(remote), false, remote)
  }
})

test('THE REGISTRY PLACES THIS SURFACE AT A PATH ON THE APEX, IN BOTH ENVIRONMENT SHAPES', () => {
  // The mainnet apex plus the mount. `hosts()[PRODUCT]` is a BASE URL, not an origin, and the
  // difference is the whole of this change — the estate composes every link to this surface from
  // exactly this value.
  assert.equal(
    atPage('https://cloudsforge.online/exchange', () => hosts()[PRODUCT]),
    'https://cloudsforge.online/exchange',
  )
  assert.equal(atPage('https://cloudsforge.online/exchange', placementIsKnown), true)

  // Anywhere UNDER the mount is placed too, because that is where a reader actually is most of the
  // time — the front door is one address out of a surface full of them.
  assert.equal(atPage('https://cloudsforge.online/exchange/pools', placementIsKnown), true)

  // The environment is a SUFFIX on the first label, never a second one. Cloudflare's Universal SSL
  // wildcard matches exactly one label. The apex surface has no label to suffix, so the environment
  // stands alone as `testnet.cloudsforge.online` — and the mount rides on it unchanged, which is
  // the property that lets one image serve both estates.
  assert.equal(
    atPage('https://testnet.cloudsforge.online/exchange', () => hosts()[PRODUCT]),
    'https://testnet.cloudsforge.online/exchange',
  )
  assert.equal(atPage('https://testnet.cloudsforge.online/exchange', placementIsKnown), true)

  // And a testnet page composes TESTNET siblings. The failure this rules out is the quiet one: a
  // suffixed hostname resolving to the mainnet apex, where every link works and points at real
  // money. On this surface that is not a metaphor — the links go to an explorer, and the addresses
  // beneath them would be a different chain's.
  assert.match(atPage('https://testnet.cloudsforge.online/exchange', () => hosts().site), /testnet/)

  // A local checkout is always placed — the registry resolves every surface to a localhost port,
  // and `vite.config.ts`'s `base` makes the dev server answer under the mount, so this is the
  // address `pnpm dev` really serves rather than an approximation of it.
  assert.equal(atPage('http://localhost:5194/exchange', placementIsKnown), true)
})

test('AN ADDRESS THE REGISTRY CANNOT PLACE SAYS SO INSTEAD OF GUESSING', () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Served from a name the registry cannot strip, the whole name becomes the apex and every estate
  // URL on the page resolves one level too deep. On most surfaces that is cosmetic: a footer link
  // 404s. HERE IT IS THE PRODUCT. `lib/rpc.ts` composes the JSON-RPC endpoint from this same apex,
  // so an unregistered placement is a page that cannot read a chain at all — and the honest
  // rendering of that is the notice plus an unreachable state, not a spinner that never resolves.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  assert.equal(atPage('https://some-preview.example.net/', placementIsKnown), false)
  // Another surface's hostname is not this one either: `hub` IS known, so the apex comes out right
  // and every link works — but this bundle is not what belongs there, and saying so is cheaper than
  // leaving somebody to wonder why an exchange is being served from the hub.
  assert.equal(atPage('https://hub.cloudsforge.online/', placementIsKnown), false)
})

test('an explorer link is composed from the registry and encodes what it is given', () => {
  // The explorer is a registry surface, so its base follows the viewed network like any other
  // sibling — which is the whole reason these two helpers take the resolved hosts rather than
  // calling `cloudsforgeHosts()` themselves. A transaction hash on this page is the receipt for a
  // swap somebody just signed, and it must point at the chain they signed on.
  const estate = atPage('https://exchange-testnet.cloudsforge.online/', hosts)
  assert.match(estate.explorer, /testnet/)
  assert.equal(
    explorerAddressUrl(estate, '0xAbCd'),
    `${estate.explorer}/address/0xAbCd`,
  )
  assert.equal(explorerTxUrl(estate, '0x00ff'), `${estate.explorer}/tx/0x00ff`)
  // Encoded, because the argument is not always an address: a pool page renders a link for whatever
  // was in the URL so that a mistyped one gets an explanation rather than the not-found page.
  assert.equal(explorerAddressUrl(estate, 'a/b c'), `${estate.explorer}/address/a%2Fb%20c`)
})
