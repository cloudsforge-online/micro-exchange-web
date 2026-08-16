/**
 * The four pages, mounted, against a chain on the wire.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR, ON THIS SURFACE SPECIFICALLY.
 *
 * Every other frontend in the estate can be wrong in one of two ways: it shows a stale number, or it
 * shows nothing. This one can be wrong in a third — it can show a number that is right about a
 * DIFFERENT CHAIN, next to a button that signs. So the scenarios below are weighted towards the
 * cases where a page has something to say and the honest answer is that it does not know: an
 * unreachable node, a chain with no exchange on it, a factory that would not answer, a pair contract
 * at an address the factory's own derivation does not produce.
 *
 * Doc 22 §2.4.3: elements are addressed by accessible role and name, never by class or DOM path. A
 * markup change must not break these; an accessible-name change must.
 *
 * ── THE ASSERTION THIS FILE EXISTS TO CARRY ─────────────────────────────────────────────────
 *
 * `src/app.tsx` puts `ChainProvider` INSIDE `BrowserRouter` and above the routes, and says of
 * itself: "a context read above its own provider silently returns the default, and the default here
 * — `status: 'unknown'` — renders a loading state. A safe default is exactly why the ordering has to
 * be asserted rather than trusted to fail loudly, and `test/render.test.ts` asserts it by mounting
 * the app and checking that a chain with no exchange produces no `eth_call`."
 *
 * That is `mounts nothing against a chain the exchange is not deployed on` below.
 *
 * ── NO HAND-WRITTEN HEX ─────────────────────────────────────────────────────────────────────
 *
 * The wire is stubbed once, in `test/fixtures.ts`, which encodes returns by the ABI's own rules and
 * derives every selector through `abi.ts`'s own `selector()`. A scenario needing another contract
 * function adds it there rather than pasting a word of hex here. `unmodelled` is asserted empty
 * wherever a page is expected to read successfully — without that, a fixture that shrugged at a call
 * would be indistinguishable from a contract that is not there, and these tests would go green
 * against pages rendering "the pool did not answer".
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { App } from '../src/app.tsx'
import { NOT_CUSTODIED } from '../src/lib/format.ts'
import { assertMounted, mount, withScreen, type Screen } from './dom.ts'
import {
  chain,
  ethCalls,
  rpcMethods,
  market,
  EMBER_NEFELI,
  EMBER_SILT,
  FEE_SETTER,
  HEARTH,
  IMPOSTOR_PAIR,
  NEFELI,
  OTHER_CHAIN_ID,
  QUIET,
  SILT,
  WEMBER,
  type ChainFixture,
} from './fixtures.ts'

/** This surface's own address on the mainnet estate. */
const AT = 'https://exchange.cloudsforge.online'

/** The vite dev server. No chain endpoint is composed for it, deliberately. */
const DEV = 'http://localhost:5194/'

const app = () => createElement(App)

/**
 * Mount at `path` against `fixture`, run `body`, and assert the fixture was never asked for
 * something it does not model.
 *
 * The `unmodelled` check lives in the helper rather than in each scenario because it is the kind of
 * assertion that is worth nothing if it has to be remembered and everything if it is automatic.
 * Scenarios whose SUBJECT is a read that fails call `withScreen` directly instead.
 */
async function page(
  fixture: ChainFixture,
  path: string,
  body: (screen: Screen) => Promise<void>,
): Promise<void> {
  await withScreen(app(), { url: `${AT}${path}`, routes: fixture.routes }, async (screen) => {
    await screen.settle()
    await body(screen)
    assert.deepEqual(
      fixture.unmodelled,
      [],
      'the page asked the chain for something test/fixtures.ts does not model, so every panel that ' +
        'depended on it rendered a failure state and the assertions above proved nothing',
    )
  })
}

/** The value in the "You receive" field, which is an `<output>` because it is not editable. */
const received = (screen: Screen): string =>
  screen.textOf(screen.document.querySelector('output'))

describe('the swap page', () => {
  it('reads a market off the chain and quotes a trade through the router', async () => {
    const fixture = chain()
    await page(fixture, '/', async (screen) => {
      assertMounted(screen)
      assert.match(screen.text(), /Swap/)
      // The tokens are DERIVED from the pools, so both sides of the one market are selectable
      // without anything in this repository naming them.
      assert.match(screen.text(), /NEFELI/)

      // Nothing is quoted until an amount exists: a quote for zero is not a fact about anything.
      assert.equal(received(screen), '—')

      await screen.type(screen.byRole('textbox', 'Amount to pay'), '10')
      await screen.settle()

      // Ten EMBER into a pool holding 25,000 EMBER against 4,950,000 NEFELI, at the 0.3% fee. The
      // exact fill is not written down here — what the assertion is about is that the page printed
      // the ROUTER's answer, and the magnitude is enough to catch a decimals error either way.
      assert.match(received(screen), /^1,?9[0-9]{2}(\.[0-9]+)?$/, `received "${received(screen)}"`)
      assert.ok(
        ethCalls(screen.api.wire).some(
          (c) => c.to === HEARTH.router.toLowerCase() && c.fn === 'getAmountsOut',
        ),
        'the page filled in "You receive" without asking the router what the trade fills at',
      )
    })
  })

  it('shows what the trade does to the pool, and what the reader is agreeing to', async () => {
    await page(chain(), '/', async (screen) => {
      await screen.type(screen.byRole('textbox', 'Amount to pay'), '10')
      await screen.settle()
      const text = screen.text()
      assert.match(text, /Impact of this trade/)
      assert.match(text, /Fee, kept by the pool/)
      assert.match(text, /You get at least/)
      assert.match(text, /Before you press it/)
      assert.match(text, /Nothing here is reversible/)
    })
  })

  it('PUTS THE FORM BEFORE THE PICTURE, so the control is not below the fold', async () => {
    // micro-org#145: a stake control that lived in a right-hand column was invisible on the page
    // that needed it — "the submission is hidden in the right column if you scroll". Document order
    // is the part of that a test can hold; the columns themselves are CSS.
    await page(chain(), '/', async (screen) => {
      screen.before(
        'You pay',
        'The pool, and where your trade lands on it',
        'the swap form has to come before the curve that illustrates it',
      )
    })
  })

  it('says plainly that nothing here can be signed, without hiding the numbers', async () => {
    // No `windowExtras.ethereum`, so there is no injected provider — the common case for a first
    // visit, and the one where a page gating its whole content on a wallet would show nothing.
    await page(chain(), '/', async (screen) => {
      assert.match(screen.text(), /No wallet is installed in this browser/)
      assert.match(screen.text(), /Every number on this page is still real/)
      assert.equal(screen.queryByRole('button', /Connect a wallet/), null)
    })
  })

  it('refuses a pair no pool holds, rather than quoting one', async () => {
    // Two markets, so SILT and NEFELI are both selectable — and no pool holds the two together.
    await page(chain({ pairs: [EMBER_NEFELI, EMBER_SILT] }), '/', async (screen) => {
      await screen.type(screen.byRole('textbox', 'Amount to pay'), '10')
      await screen.settle()
      await screen.type(screen.byRole('combobox', 'Token to pay with'), SILT.address)
      await screen.settle()
      // The curve panel carries it rather than the action line, because `SwapAction` answers the
      // more basic question first — there is no wallet in this browser, so nothing here could be
      // signed even for a pair that did have a pool. Both sentences are true; the ordering is the
      // one that page argues for, and this asserts the reader is told about the missing pool
      // either way rather than left with an empty field and no reason for it.
      assert.match(screen.text(), /There is no pool for this pair\. Anyone may create one/)
      assert.equal(received(screen), '—')
    })
  })

  it('reports a factory that did not answer as a FAILURE, never as an empty market', async () => {
    // The distinction this surface's whole error handling turns on. `readAllPairs` returns null
    // when the count could not be read, precisely so an outage renders as a fault in the reading
    // rather than as a chain with no markets on it.
    const broken = chain({ refuses: ['eth_call'] })
    await withScreen(app(), { url: AT, routes: broken.routes }, async (screen) => {
      await screen.settle()
      assert.match(screen.text(), /The markets did not load/)
      assert.ok(screen.queryByRole('button', 'Read again') !== null)
      assert.doesNotMatch(screen.text(), /has not created a market yet/)
    })
  })
})

describe('the chain the page is pointed at', () => {
  it('mounts nothing against a chain the exchange is not on, AND MAKES NO eth_call', async () => {
    // The assertion `src/app.tsx` names. `ChainProvider` sits inside the router and above the
    // routes; read above its own provider the context answers `status: 'unknown'`, which renders a
    // loading state — a page that looks like it is working while every route below it reads a
    // deployment that is not there. What proves the ordering is the network: on a chain with no
    // deployment there is nothing to call, so one `eth_call` means a page went looking anyway.
    const fixture = chain({ chainId: OTHER_CHAIN_ID })
    await withScreen(app(), { url: AT, routes: fixture.routes }, async (screen) => {
      await screen.settle()
      assertMounted(screen)
      assert.match(screen.text(), /Forge Exchange is not deployed on this network/)
      assert.deepEqual(
        ethCalls(screen.api.wire),
        [],
        'the page read contracts on a chain that has none',
      )
      assert.ok(rpcMethods(screen.api.wire).includes('eth_chainId'))
      assert.deepEqual(fixture.unmodelled, [])
    })
  })

  it('says there is no endpoint at all on a development host, rather than guessing one', async () => {
    await withScreen(app(), { url: DEV, routes: chain().routes }, async (screen) => {
      await screen.settle()
      assertMounted(screen)
      assert.match(screen.text(), /There is no chain endpoint for this address/)
      // Not one request left the page. An endpoint composed anyway would be a local checkout
      // reading the LIVE MAINNET CHAIN and quoting it as if it were the one in front of the
      // developer — the failure micro-org#285 filed against the pool's stratum address.
      assert.deepEqual(screen.api.wire, [])
    })
  })

  it('names the block every number was read at, on every route', async () => {
    const fixture = chain({ head: 41_207 })
    for (const path of ['/', '/pools', '/contracts']) {
      await page(fixture, path, async (screen) => {
        assert.match(screen.text(), /Block\s*#?41,207/, `no block on ${path}`)
      })
    }
  })

  it('repeats that CloudsForge holds nothing, on every route', async () => {
    const fixture = chain()
    for (const path of ['/', '/pools', '/contracts']) {
      await page(fixture, path, async (screen) => {
        assert.ok(screen.text().includes(NOT_CUSTODIED.slice(0, 44)), `not on ${path}`)
      })
    }
  })

  it('offers no sign-in anywhere, because there is nothing to sign in to', async () => {
    // `shell.tsx` leaves `CloudsForgeBar` out on exactly this ground: every route here is public,
    // nothing is stored against an account, and a "Sign in" would suggest otherwise.
    const fixture = chain()
    for (const path of ['/', '/pools', '/contracts']) {
      await page(fixture, path, async (screen) => {
        assert.equal(screen.queryByRole('button', /Sign in/), null, `sign-in on ${path}`)
        assert.equal(screen.queryByRole('link', /Sign in/), null, `sign-in link on ${path}`)
      })
    }
  })
})

describe('the pools page', () => {
  it('lists what the factory made, and says how many that is', async () => {
    await page(chain(), '/pools', async (screen) => {
      assertMounted(screen)
      assert.match(screen.text(), /1 pool on this chain/)
      assert.match(screen.text(), /NEFELI/)
      assert.match(screen.text(), /A pool appearing here is not a recommendation/)
    })
  })

  it('SAYS WHEN IT IS SHOWING A PAGE OF A LONGER LIST, not implying that is all of them', async () => {
    // Fifty-two markets against a page limit of fifty. A silent cap tells a reader looking for a
    // market that it does not exist.
    const many = Array.from({ length: 52 }, (_, i) =>
      market(
        WEMBER,
        1_000n * 10n ** 18n,
        { address: `0x${(i + 1).toString(16).padStart(40, '0')}`, symbol: `TK${i}`, decimals: 18 },
        2_000n * 10n ** 18n,
      ),
    )
    await page(chain({ pairs: many }), '/pools', async (screen) => {
      assert.match(screen.text(), /The first 50 of 52 pools\. This page reads at most 50/)
    })
  })

  it('distinguishes a factory with no markets from a factory that would not answer', async () => {
    await page(chain({ pairs: [] }), '/pools', async (screen) => {
      assert.match(screen.text(), /The factory has not created a market yet/)
      assert.match(screen.text(), /Nothing is wrong/)
    })

    const broken = chain({ refuses: ['eth_call'] })
    await withScreen(app(), { url: `${AT}/pools`, routes: broken.routes }, async (screen) => {
      await screen.settle()
      assert.match(screen.text(), /The factory did not answer/)
      assert.doesNotMatch(screen.text(), /has not created a market yet/)
      assert.ok(screen.queryByRole('button', 'Read again') !== null)
    })
  })

  it('renders a token that will not say what it is, without pretending it did', async () => {
    const odd = market(WEMBER, 500n * 10n ** 18n, QUIET, 900n * 10n ** 18n)
    await page(chain({ pairs: [odd] }), '/pools', async (screen) => {
      assertMounted(screen)
      // The address stands in for the symbol. A blank chip would read as a token with no name
      // rather than as a contract that would not answer.
      assert.match(screen.text(), new RegExp(QUIET.address.slice(2, 8), 'i'))
    })
  })
})

describe('a single pool', () => {
  it('derives the address in the browser and says it is the canonical one', async () => {
    await page(chain(), `/pools/${EMBER_NEFELI.address}`, async (screen) => {
      assertMounted(screen)
      assert.match(screen.text(), /This is the canonical pair for these two tokens/)
      assert.match(screen.text(), /The invariant/)
      assert.match(screen.text(), /What it holds/)
    })
  })

  it('SAYS SO WHEN THE ADDRESS IS NOT THE ONE THE DERIVATION PRODUCES', async () => {
    // A contract that answers `getReserves`, `token0` and `token1` exactly like a pair, sitting at
    // an address CREATE2 does not put it at. Nothing about how it behaves distinguishes it; only
    // the arithmetic does, and this page does that arithmetic in the reader's own browser.
    const impostor = market(WEMBER, 25_000n * 10n ** 18n, NEFELI, 4_950_000n * 10n ** 18n, {
      address: IMPOSTOR_PAIR,
    })
    await page(chain({ pairs: [impostor] }), `/pools/${IMPOSTOR_PAIR}`, async (screen) => {
      assertMounted(screen)
      assert.match(screen.text(), /is not the address the factory’s own derivation produces/)
      assert.match(screen.text(), /Treat it with suspicion/)
      // And it prints the address it derived, so the two strings can be compared by eye rather
      // than taken on this page's word.
      assert.match(screen.text(), new RegExp(EMBER_NEFELI.address.slice(2, 10), 'i'))
    })
  })

  it('refuses an address that is not an address, without asking the chain about it', async () => {
    const fixture = chain()
    await page(fixture, '/pools/not-an-address', async (screen) => {
      assert.match(screen.text(), /That is not a pair address/)
      assert.deepEqual(
        ethCalls(screen.api.wire).filter((c) => c.fn === 'getReserves'),
        [],
      )
    })
  })

  it('reports a contract that answered nothing as unreadable, not as an empty pool', async () => {
    // A well-formed address with no pair behind it. `readReserves` returns null, and the page names
    // both live possibilities rather than choosing one it cannot distinguish.
    const stranger = '0x1111111111111111111111111111111111111111'
    await withScreen(
      app(),
      { url: `${AT}/pools/${stranger}`, routes: chain().routes },
      async (screen) => {
        await screen.settle()
        assert.match(screen.text(), /Nothing at this address answered as a pool/)
      },
    )
  })
})

describe('the contracts page', () => {
  it('runs every check against the chain and prints both sides of each', async () => {
    await page(chain(), '/contracts', async (screen) => {
      assertMounted(screen)
      const text = screen.text()
      assert.match(text, /The contracts/)
      assert.match(text, /pair code hash match/)
      assert.match(text, /does it come out where the factory says it is/)
      assert.match(text, /Does the router point at this factory and this wrapped coin/)
      assert.match(text, /Is the protocol fee switch off/)

      // Both sides, printed. A check that is only ever a verdict is a claim.
      assert.match(text, /The factory says/)
      assert.match(text, /This page uses/)
      assert.match(text, /Derived in this browser/)
      assert.match(text, /The factory answers/)
      assert.match(text, new RegExp(HEARTH.factory.slice(2, 10), 'i'))
      assert.match(text, new RegExp(FEE_SETTER.slice(2, 10), 'i'))
      assert.match(text, /They match/)

      // A fee switch at the zero address is off, and the page says what that means for the 0.3%.
      assert.match(text, /No protocol fee is being taken/)
      assert.match(text, /can change that at any time/)
    })
  })

  it('CALLS A MISMATCHED INIT-CODE HASH A MISMATCH, the failure a working factory hides', async () => {
    // The factory reports a hash this bundle does not derive addresses with. Every address the
    // router computes then points at nothing and every trade reverts — while the pools page, which
    // asks the factory directly, carries on listing markets perfectly.
    await page(chain({ pairCodeHash: `0x${'ab'.repeat(32)}` }), '/contracts', async (screen) => {
      assert.match(screen.text(), /They differ/)
      assert.match(screen.text(), /every trade reverts/)
    })
  })

  it('reports a protocol fee that is being taken, in those words', async () => {
    await page(chain({ feeTo: FEE_SETTER }), '/contracts', async (screen) => {
      assert.match(screen.text(), /A protocol fee is being taken and sent to the address above/)
    })
  })

  it('says the checks could not be RUN when the node refused, not that they failed', async () => {
    const broken = chain({ refuses: ['eth_call'] })
    await withScreen(app(), { url: `${AT}/contracts`, routes: broken.routes }, async (screen) => {
      await screen.settle()
      assert.match(screen.text(), /The checks could not be run/)
      assert.match(screen.text(), /a fault in the reading, not a finding about the contracts/)
    })
  })
})

describe('the shell', () => {
  it('renders something honest at an address that is not a route', async () => {
    // nginx answers unknown paths with `error_page 404 /index.html`, so the bundle mounts under the
    // real status rather than `try_files`-ing every address into a 200. What React owes that
    // arrangement is a page that says where the reader is.
    await page(chain(), '/nothing-here', async (screen) => {
      assertMounted(screen)
      assert.match(screen.text(), /page/i)
      assert.ok(screen.queryByRole('link', /Swap|Pools/) !== null)
    })
  })

  it('mounts every route without a console error', async () => {
    const fixture = chain()
    for (const path of ['/', '/pools', `/pools/${EMBER_NEFELI.address}`, '/contracts']) {
      const screen = await mount(app(), { url: `${AT}${path}`, routes: fixture.routes })
      try {
        await screen.settle()
        assertMounted(screen)
        screen.clean(`mounting ${path}`)
      } finally {
        await screen.unmount()
      }
    }
    assert.deepEqual(fixture.unmodelled, [])
  })
})
