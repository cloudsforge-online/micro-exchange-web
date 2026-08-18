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
import { pairFor } from '../src/lib/dex.ts'
import { NOT_CUSTODIED } from '../src/lib/format.ts'
import { setViewedNetwork } from '../src/lib/viewed.ts'
import { installWindow, removeWindow } from './browser-stubs.ts'
import { assertMounted, mount, withScreen, type MountOptions, type Screen } from './dom.ts'
import {
  chain,
  ethCalls,
  holding,
  rpcMethods,
  market,
  wallet,
  CHAIN_NOW,
  DEMBER,
  EMBER_NEFELI,
  EMBER_SILT,
  FEE_SETTER,
  FLTC,
  HEARTH,
  HOLDER,
  IMPOSTOR_PAIR,
  NEFELI,
  OTHER_CHAIN_ID,
  QUIET,
  RECEIPT_CHAIN_ID,
  SILT,
  WALLET_TX_HASH,
  WEMBER,
  type ChainFixture,
  type FixtureReceipt,
  type FixtureRedemption,
  type WalletStub,
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
 *
 * `stub` installs an injected wallet. It is the fourth argument rather than part of the fixture
 * because the chain and the wallet are separate things that a scenario deliberately disagrees about
 * — a wallet on chain 1 reading a page pointed at 7411 is the case the switch button exists for.
 */
async function page(
  fixture: ChainFixture,
  path: string,
  body: (screen: Screen) => Promise<void>,
  stub?: WalletStub,
): Promise<void> {
  const options: MountOptions = {
    url: `${AT}${path}`,
    routes: fixture.routes,
    ...(stub === undefined ? {} : { windowExtras: { ethereum: stub.provider } }),
  }
  await withScreen(app(), options, async (screen) => {
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

/**
 * micro-org#496. Two products now carry a control called "swap", and they differ in the only way
 * that matters: who is holding the coins while it happens. The seam at the foot of the swap page is
 * the one place on this surface that says so, and these are the ways it can be worse than nothing —
 * a link that goes to the wrong estate, and prose that describes the two venues as the same thing.
 *
 * The sentences are written out longhand below rather than imported from `src/`. A test that
 * compares the screen with the constant the screen rendered from is green for every value of that
 * constant, including a paraphrase that has quietly lost the custody clause.
 */
describe('the seam to the custodial desk', () => {
  /** Forge Hub's own address on this estate, and the desk's address inside it. */
  const HUB = 'https://hub.cloudsforge.online'
  const HUB_TESTNET = 'https://hub-testnet.cloudsforge.online'
  const desk = (screen: Screen): Element => screen.byRole('link', /Convert in Forge Hub/)

  it('says which side of the custody line each venue is on', async () => {
    await page(chain(), '/', async (screen) => {
      const text = screen.text()
      // The desk's half: a quoted rate, out of CloudsForge's own holdings, both sides held by
      // CloudsForge.
      assert.match(text, /a different arrangement, not a second door to this one/)
      assert.match(text, /quotes you a rate/)
      assert.match(text, /out of its own holdings/)
      assert.match(text, /keeps custody of both sides/)
      // This surface's half, and it is the half a reader must not carry across: nothing is held
      // here and nothing can be given back. The chain's name is composed from the deployment, so
      // the sentence is true of whichever Hearth the wallet is on rather than of the one this
      // repository was written on.
      assert.match(text, /a contract on Hearth\b/)
      assert.match(text, /your own wallet signs/)
      assert.match(text, /CloudsForge holds nothing and can put nothing back/)
      // And what the desk actually credits, which is the sentence that stops somebody converting
      // and then looking for the coin in the wallet this page reads.
      assert.match(text, /not the wallet this page reads/)
    })
  })

  it('links at the desk itself, on the estate serving this page', async () => {
    await page(chain(), '/', async (screen) => {
      assert.equal(desk(screen).getAttribute('href'), `${HUB}/convert`)
    })
  })

  it('FOLLOWS THE VIEWED NETWORK, so the desk it offers holds the balances on screen', async () => {
    // The bug this pins is silent and it is not the reader's to notice: they press Testnet, look at
    // testnet pools, follow this link, and land on a MAINNET account holding none of it. The link
    // is composed through `viewedSurfaceUrl`, which answers for the network being viewed rather
    // than for the hostname — under the combined view both estates are served from the mainnet
    // names, so the address bar is not an answer to this question.
    //
    // The choice is module state in `src/lib/viewed.ts`, so it is set with a window installed and
    // put back afterwards whatever happens; a leaked override would re-point every scenario
    // declared after this one.
    const browser = installWindow(`${AT}/`)
    try {
      setViewedNetwork('testnet')
    } finally {
      removeWindow()
    }
    try {
      await page(chain(), '/', async (screen) => {
        assert.equal(desk(screen).getAttribute('href'), `${HUB_TESTNET}/convert`)
      })
    } finally {
      installWindow(`${AT}/`)
      try {
        setViewedNetwork('mainnet')
      } finally {
        removeWindow()
      }
    }
    assert.ok(browser.assigned.length === 0, 'nothing here navigates; the link is an href')
  })

  it('is still there when the factory has no market to trade against', async () => {
    // The reader with nothing to swap is the one the seam is most use to, so it sits OUTSIDE the
    // branch that renders the form. Putting it inside would have hidden it in exactly the state
    // where "there is another way to do this" is the only useful thing left on the page.
    await page(chain({ pairs: [] }), '/', async (screen) => {
      assert.match(screen.text(), /has not created a market yet/)
      assert.equal(desk(screen).getAttribute('href'), `${HUB}/convert`)
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
    for (const path of ['/', '/pools', '/receipts', '/contracts']) {
      await page(fixture, path, async (screen) => {
        assert.match(screen.text(), /Block\s*#?41,207/, `no block on ${path}`)
      })
    }
  })

  it('repeats that CloudsForge holds nothing, on every route', async () => {
    // Including `/receipts`, where it is the sentence that most needs qualifying and is qualified —
    // the footer says the exchange holds nothing, and the page's own warning says a receipt is the
    // one thing on this surface that CloudsForge does hold. Both are true and both are printed;
    // dropping the footer there would have been the quieter, worse fix.
    const fixture = chain()
    for (const path of ['/', '/pools', '/receipts', '/contracts']) {
      await page(fixture, path, async (screen) => {
        assert.ok(screen.text().includes(NOT_CUSTODIED.slice(0, 44)), `not on ${path}`)
      })
    }
  })

  it('offers a sign-in on every route, and GATES none of them behind it', async () => {
    // ════════════════════════════════════════════════════════════════════════════════════════════
    // This test used to assert the opposite — "offers no sign-in anywhere, because there is nothing
    // to sign in to" — on the ground that `shell.tsx` left `CloudsForgeBar` out: every route here is
    // public, nothing is stored against an account, and a "Sign in" would suggest otherwise.
    //
    // The premise survived and the conclusion did not. The bar is the estate's chrome rather than an
    // authorisation mechanism, and a page without it reads as a page that fell off the estate — the
    // one impression a stranger must not form about the page that handles their money. So the
    // control is here, and what this test now holds is the half that was always the point: A READER
    // WHO NEVER PRESSES IT SEES EVERYTHING. Every number below is rendered while `account.signedIn`
    // is false, on all four routes.
    //
    // The DOM node is deliberately never passed to `assert.equal` as an actual value. happy-dom
    // elements carry a reference to their own window, and node:test formatting the diff for one
    // walks that graph — the previous shape of this test took 133 seconds to report a one-line
    // failure. Booleans and strings only, from here on.
    // ════════════════════════════════════════════════════════════════════════════════════════════
    const fixture = chain()
    for (const path of ['/', '/pools', '/receipts', '/contracts']) {
      await page(fixture, path, async (screen) => {
        assert.ok(
          screen.queryByRole('button', /Sign in/) !== null ||
            screen.queryByRole('link', /Sign in/) !== null,
          `no sign-in control on ${path}; the shared bar is not rendering its account menu`,
        )
        // ...and the page under it is a page, not a wall. `assertMounted` is the same check every
        // scenario in this file opens with, so "renders for a stranger" means exactly what it means
        // everywhere else here.
        assertMounted(screen)
        assert.ok(
          screen.text().includes(NOT_CUSTODIED.slice(0, 44)),
          `the standing notice is missing on ${path} for a signed-out reader`,
        )
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE LIQUIDITY PAGES, WHERE THIS SURFACE STOPS BEING A READING AND BECOMES A SIGNATURE.
 *
 * Every scenario above can fail by showing a wrong number. The ones below can fail by showing a
 * wrong number NEXT TO A BUTTON THAT SPENDS SOMEBODY'S MONEY, and those are not the same size of
 * mistake. So each of them asserts on `stub.sent` — the exact `{ from, to, data, value }` the page
 * handed the wallet — as well as on what was drawn.
 *
 * `test/wallet.test.ts` proves the builders encode the right words in the right order. These prove
 * the PAGE reaches for the right builder with the reader's own numbers, and that what it drew
 * around it was true at the moment it was pressed. NEITHER proves a real wallet accepts the
 * calldata: that is `wallet-extension/test/e2e/`, against a real node, with no interception at all.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */

/** The value of a form control, as a string. Read for the fields the page fills in by itself. */
const valueOf = (el: Element): string => (el as unknown as { value: string }).value

/**
 * The pool these scenarios supply, with its LP supply CHOSEN rather than derived.
 *
 * `market()` defaults the supply to `sqrt(reserve0·reserve1)`, which is what a pair mints on a
 * first deposit and is 351,781.18… here. A tenth of that is not a round number of anything, so
 * every amount downstream would be asserted with a regex loose enough to pass against an
 * off-by-a-decimal-place. A supply of 100,000 makes `LP` exactly a tenth of the pool and every
 * figure on both pages exact.
 *
 * BELOW sqrt(k), not above, because that is the only side that can exist: fees raise `k` without
 * minting, so a pool that has traded has a supply under its own root, and a fixture with a supply
 * over it would be a pool no sequence of transactions could produce.
 */
const SUPPLIED = market(WEMBER, 25_000n * 10n ** 18n, NEFELI, 4_950_000n * 10n ** 18n, {
  totalSupply: 100_000n * 10n ** 18n,
})

/** What the holder has of it: a tenth, exactly. */
const LP = 10_000n * 10n ** 18n

/** The pool the deposit scenarios use, which is `test/fixtures.ts`'s own. NEFELI is `token0`. */
const ADD = `/pools/${EMBER_NEFELI.address}/add`
const REMOVE = `/pools/${SUPPLIED.address}/remove`

/** Enough of both tokens to deposit, and the router already allowed to move the ERC-20 one. */
const funded = (options: Parameters<typeof chain>[0] = {}): ChainFixture =>
  chain({
    balances: { [holding(NEFELI.address, HOLDER)]: 20_000n * 10n ** 18n },
    allowances: { [holding(NEFELI.address, HOLDER)]: 20_000n * 10n ** 18n },
    native: { [HOLDER]: 100n * 10n ** 18n },
    ...options,
  })

/** Type an amount into the NEFELI side and press the one button that signs. */
async function depositNefeli(screen: Screen, amount = '9900'): Promise<void> {
  await screen.type(screen.byRole('textbox', 'Amount of NEFELI to deposit'), amount)
  await screen.settle()
  await screen.click(screen.byRole('button', 'Add liquidity'))
  await screen.settle()
}

describe('adding liquidity', () => {
  it('FILLS THE OTHER SIDE FROM THE RESERVES, and asks the router for nothing', async () => {
    // The deliberate difference from `swap.tsx`, argued at the top of `pages/add-liquidity.tsx`: a
    // swap quote is a FILL and is read from the router, a deposit's counter-amount is not a fill at
    // all — `_addLiquidity` recomputes it in the block it executes in. Asking per keystroke would
    // buy a number that is just as provisional, one round trip later.
    const fixture = funded()
    await page(
      fixture,
      ADD,
      async (screen) => {
        assertMounted(screen)
        await screen.type(screen.byRole('textbox', 'Amount of NEFELI to deposit'), '9900')
        await screen.settle()

        // 9,900 NEFELI against reserves of 4,950,000 NEFELI and 25,000 EMBER is 50 EMBER, at the
        // pool's own ratio and with no fee — a deposit is not a trade.
        assert.equal(valueOf(screen.byRole('textbox', 'Amount of EMBER to deposit')), '50')
        assert.deepEqual(
          ethCalls(screen.api.wire).filter((c) => c.fn === 'getAmountsOut'),
          [],
          'the deposit form quoted itself through the router, per keystroke',
        )
        assert.match(screen.text(), /Pool tokens minted/)
        assert.match(screen.text(), /You deposit at least/)
      },
      wallet(),
    )
  })

  it('reads the FEE SWITCH off the factory rather than claiming it in prose', async () => {
    await page(funded({ feeTo: FEE_SETTER }), ADD, async (screen) => {
      assert.match(screen.text(), /ON — part of the fee goes elsewhere/)
    })
    await page(funded(), ADD, async (screen) => {
      assert.match(screen.text(), /off — the whole 0\.3% stays in the pool/)
    })
  })

  it('SAYS THE FIRST DEPOSIT SETS THE PRICE, and prints the price it would set', async () => {
    // The one place on this surface where a typo costs a large fraction of what was put in, and the
    // one the issue calls out by name. An empty pool has no ratio to conform to, so the ratio
    // deposited becomes the price and nothing anywhere puts it back.
    const empty = market(WEMBER, 0n, NEFELI, 0n)
    await page(
      chain({ pairs: [empty], native: { [HOLDER]: 100n * 10n ** 18n } }),
      `/pools/${empty.address}/add`,
      async (screen) => {
        assert.match(screen.text(), /This is the first deposit/)
        assert.match(screen.text(), /the ratio you deposit becomes its price/)
        assert.match(screen.text(), /the first person to trade takes the difference out of your/)
        assert.ok(screen.queryByRole('alert', /This is the first deposit/) !== null)

        await screen.type(screen.byRole('textbox', 'Amount of NEFELI to deposit'), '1000')
        await screen.settle()
        // AND THE OTHER SIDE STAYS EMPTY. On an empty pool the two amounts are independent by
        // definition — that is what "you are setting the price" means — so a page that auto-filled
        // one from the other would be inventing the ratio it is warning about.
        assert.equal(valueOf(screen.byRole('textbox', 'Amount of EMBER to deposit')), '')

        await screen.type(screen.byRole('textbox', 'Amount of EMBER to deposit'), '5')
        await screen.settle()
        assert.match(screen.text(), /At the amounts above the price would be/)
        assert.match(screen.text(), /0\.005 EMBER per NEFELI/)
      },
      wallet(),
    )
  })

  it('hands the wallet ONE transaction, to the router, with the native side as `value`', async () => {
    const stub = wallet()
    await page(
      funded(),
      ADD,
      async (screen) => {
        await depositNefeli(screen)

        assert.equal(stub.sent.length, 1, 'a deposit is one signature when the allowance is there')
        const [tx] = stub.sent
        assert.equal(tx?.to.toLowerCase(), HEARTH.router.toLowerCase())
        assert.equal(tx?.from.toLowerCase(), HOLDER)
        // The EMBER side rides as `value`, not as an argument. Sending it as both is how a deposit
        // takes twice what the reader asked it to; `test/wallet.test.ts` asserts the word list.
        assert.equal(BigInt(tx?.value ?? '0x0'), 50n * 10n ** 18n)

        // And it is remembered. The state this whole mechanism exists for is the one AFTER the
        // wallet returns a hash, which the shape this replaced could not say anything about.
        assert.match(screen.text(), /sent, waiting for a block/)
        assert.ok(screen.queryByRole('region', 'Transactions this page sent') !== null)
        // The form is cleared, so the same deposit cannot be sent twice by a second click.
        assert.equal(valueOf(screen.byRole('textbox', 'Amount of NEFELI to deposit')), '')
      },
      stub,
    )
  })

  it('ASKS FOR THE ALLOWANCE FIRST, and sends it to the token rather than to the router', async () => {
    // Two transactions, and the first one goes somewhere else. An approval sent to the router is
    // the mistake that looks like it worked — the router is not the ledger that records it.
    const stub = wallet()
    await page(
      funded({ allowances: {} }),
      ADD,
      async (screen) => {
        await screen.type(screen.byRole('textbox', 'Amount of NEFELI to deposit'), '9900')
        await screen.settle()
        const button = screen.byRole('button', /Allow the router to move this NEFELI/)
        await screen.click(button)
        await screen.settle()

        assert.equal(stub.sent.length, 1)
        assert.equal(stub.sent[0]?.to.toLowerCase(), NEFELI.address.toLowerCase())
        assert.notEqual(stub.sent[0]?.to.toLowerCase(), HEARTH.router.toLowerCase())
        assert.equal(BigInt(stub.sent[0]?.value ?? '0x1'), 0n)
        assert.match(screen.text(), /Approval/)
      },
      stub,
    )
  })

  it('CALLS A MINED-AND-REVERTED DEPOSIT REVERTED, in an alert, not "sent"', async () => {
    // The defect the issue names. Gas was spent, the hash is real, nothing moved — and the shape
    // every DEX frontend ships says "sent ✓" and then goes quiet.
    const stub = wallet()
    await page(
      funded({ mined: { [WALLET_TX_HASH]: { reverted: true } } }),
      ADD,
      async (screen) => {
        await depositNefeli(screen)
        await screen.settle()
        assert.match(screen.text(), /was mined and reverted — the gas was spent and nothing moved/)
        assert.match(screen.text(), /the price passed the minimum you set, or the deadline expired/)
        assert.ok(screen.queryByRole('alert', /was mined and reverted/) !== null)
        assert.doesNotMatch(screen.text(), /sent, waiting for a block/)
      },
      stub,
    )
  })

  it('KEEPS THE CONFIRMATION WHEN THE POOL IS RE-READ, and names the block', async () => {
    // This test failed when it was written, and the defect it found is the one the issue is about.
    // A settled transaction reloads the pool — that is what `onSettled` is for, so the reserves and
    // the balances stop being pre-deposit numbers. But `useResource` re-enters `loading` on a
    // reload, and a guard on the resource's STATE unmounted the entire form at that instant: the
    // page went back to "enter both amounts" with no record anywhere that the deposit had happened.
    // The confirmation was destroyed by the act of confirming it.
    const stub = wallet()
    await page(
      funded({ mined: { [WALLET_TX_HASH]: { blockNumber: 41_209 } } }),
      ADD,
      async (screen) => {
        await depositNefeli(screen)
        await screen.settle()
        assert.match(screen.text(), /confirmed in block 41209/)
        assert.ok(screen.queryByRole('region', 'Transactions this page sent') !== null)
        // And the form is still a form, rather than a spinner or a re-mounted blank one.
        assert.ok(screen.queryByRole('region', 'Add liquidity') !== null)
        assert.match(screen.text(), /Pool holds now/)
      },
      stub,
    )
  })

  it('DOES NOT PROMPT ON MOUNT, and offers the network before it offers the button', async () => {
    // `eth_accounts` opens nothing; `eth_requestAccounts` is the one that puts a dialogue in front
    // of somebody who has read nothing yet. And a wallet on another chain would sign a transaction
    // to the router's address OVER THERE, where there is either no code or somebody else's.
    const stub = wallet({ chainId: OTHER_CHAIN_ID })
    await page(
      funded(),
      ADD,
      async (screen) => {
        assert.ok(stub.asked.includes('eth_accounts'))
        assert.ok(
          !stub.asked.includes('eth_requestAccounts'),
          `the page prompted the wallet on mount: ${stub.asked.join(', ')}`,
        )
        assert.ok(screen.queryByRole('button', 'Switch your wallet to Hearth') !== null)
        assert.equal(screen.queryByRole('button', /^Add liquidity$/), null)
      },
      stub,
    )
  })

  it('treats declining as a decision: no banner, no entry, nothing tracked', async () => {
    const stub = wallet({ rejects: true })
    await page(
      funded(),
      ADD,
      async (screen) => {
        await depositNefeli(screen)
        assert.equal(stub.sent.length, 0)
        assert.equal(screen.queryByRole('region', 'Transactions this page sent'), null)
        assert.doesNotMatch(screen.text(), /User rejected/)
        // The amounts are still there, because nothing happened and the reader may press again.
        assert.equal(valueOf(screen.byRole('textbox', 'Amount of NEFELI to deposit')), '9900')
      },
      stub,
    )
  })

  it('shows every number to a reader with no wallet, and says only that nothing can be signed', async () => {
    await page(chain(), ADD, async (screen) => {
      assertMounted(screen)
      assert.match(screen.text(), /No wallet is installed in this browser/)
      assert.match(screen.text(), /Every number on this page is still real/)
      assert.match(screen.text(), /Pool holds now/)
      assert.match(screen.text(), /Before you press it/)
      assert.equal(screen.queryByRole('button', 'Connect a wallet'), null)
    })
  })
})

describe('your positions', () => {
  const twoPools = (options: Parameters<typeof chain>[0] = {}): ChainFixture =>
    chain({ pairs: [SUPPLIED, EMBER_SILT], ...options })

  it('sweeps every pool on the chain and prints what each share is worth NOW', async () => {
    // There is no positions table on a constant-product AMM: a position is a balance of a pair's
    // own ERC-20 and nothing else. The sweep is the only honest answer to "what do I have".
    const fixture = twoPools({ balances: { [holding(SUPPLIED.address, HOLDER)]: LP } })
    await page(
      fixture,
      '/pools/positions',
      async (screen) => {
        assertMounted(screen)
        assert.match(screen.text(), /1 position, across every pool on this chain/)
        assert.match(screen.text(), /10\.0%/)
        // A tenth of 4,950,000 NEFELI and of 25,000 WEMBER — the reserves, not the deposit.
        assert.match(screen.text(), /495,000/)
        assert.match(screen.text(), /2,500/)
        assert.match(screen.text(), /is not what was deposited/)
        assert.ok(screen.queryByRole('link', 'Add') !== null)
        assert.ok(screen.queryByRole('link', 'Remove') !== null)
      },
      wallet(),
    )
  })

  it('says "none" and how many pools that was checked against, rather than going quiet', async () => {
    await page(
      twoPools(),
      '/pools/positions',
      async (screen) => {
        assert.match(screen.text(), /You do not hold a share of any pool on this chain/)
        assert.match(screen.text(), /Checked 2 of 2 pools/)
        assert.match(screen.text(), /Nothing is wrong/)
      },
      wallet(),
    )
  })

  it('READS NOTHING AT ALL without a wallet, and is not a sign-in wall', async () => {
    // The address comes from the reader's own wallet or from nowhere. No CloudsForge account is
    // involved at any point, nothing is stored, and there is no address to look balances up for —
    // so the page asks the chain for nothing rather than sweeping the factory for the zero address.
    const fixture = twoPools()
    await page(fixture, '/pools/positions', async (screen) => {
      assertMounted(screen)
      assert.match(screen.text(), /No wallet is connected/)
      assert.match(screen.text(), /There is no wallet in this browser to read an address from/)
      assert.match(screen.text(), /it never asks it to sign anything/)
      assert.deepEqual(
        ethCalls(screen.api.wire),
        [],
        'the positions page read the chain with nobody to read it for',
      )
    })
  })

  it('reports a factory that would not answer as a FAILURE, not as an empty position list', async () => {
    const broken = twoPools({ refuses: ['eth_call'] })
    const stub = wallet()
    await withScreen(
      app(),
      {
        url: `${AT}/pools/positions`,
        routes: broken.routes,
        windowExtras: { ethereum: stub.provider },
      },
      async (screen) => {
        await screen.settle()
        assert.match(screen.text(), /The factory did not answer/)
        assert.match(screen.text(), /Nothing was sent and nothing was signed/)
        assert.doesNotMatch(screen.text(), /You do not hold a share of any pool/)
      },
    )
  })
})

describe('removing liquidity', () => {
  const withPosition = (options: Parameters<typeof chain>[0] = {}): ChainFixture =>
    chain({
      pairs: [SUPPLIED],
      balances: { [holding(SUPPLIED.address, HOLDER)]: LP },
      allowances: { [holding(SUPPLIED.address, HOLDER)]: LP },
      ...options,
    })

  it('shows BOTH amounts that come out, and never one number for the pair', async () => {
    // A single "value" would need a price for both tokens in some third unit, and this surface has
    // no oracle and no business inventing one.
    await page(
      withPosition(),
      REMOVE,
      async (screen) => {
        assertMounted(screen)
        assert.match(screen.text(), /Your pool tokens/)
        assert.match(screen.text(), /10,000/)
        assert.match(screen.text(), /10\.0%/)
        // The default portion is 25%: a quarter of a tenth of the pool.
        assert.match(screen.text(), /123,750/)
        assert.match(screen.text(), /625/)
        assert.match(screen.text(), /which is not the ratio you put in/)
      },
      wallet(),
    )
  })

  it('BURNS THE WHOLE BALANCE at 100%, rather than a rounded fraction of it', async () => {
    await page(
      withPosition(),
      REMOVE,
      async (screen) => {
        await screen.click(screen.byRole('radio', '100%'))
        await screen.settle()
        assert.match(screen.text(), /495,000/)
        assert.match(screen.text(), /2,500/)
      },
      wallet(),
    )
  })

  it('approves THE POOL ITSELF, which is the one approval nobody recognises', async () => {
    const stub = wallet()
    await page(
      withPosition({ allowances: {} }),
      REMOVE,
      async (screen) => {
        await screen.click(screen.byRole('button', /Allow the router to burn your pool tokens/))
        await screen.settle()
        assert.equal(stub.sent.length, 1)
        assert.equal(stub.sent[0]?.to.toLowerCase(), SUPPLIED.address.toLowerCase())
        assert.match(screen.text(), /A pair is an ERC-20 and the router has to be allowed/)
      },
      stub,
    )
  })

  it('TAKES THE EMBER SIDE AS EMBER, and takes a different path when that is cleared', async () => {
    // `removeLiquidity` returns WEMBER and `removeLiquidityETH` returns the coin. Which one arrives
    // is not something to discover afterwards, so the choice is a visible control — and the two
    // choices must reach two different entry points, which is what the selectors below say.
    const stub = wallet()
    await page(
      withPosition(),
      REMOVE,
      async (screen) => {
        assert.match(screen.text(), /Take the EMBER side as EMBER/)
        await screen.click(screen.byRole('button', /^Remove liquidity$/))
        await screen.settle()

        await screen.click(screen.byRole('checkbox', /Take the EMBER side as EMBER/))
        await screen.settle()
        assert.match(screen.text(), /WEMBER/)
        await screen.click(screen.byRole('button', /^Remove liquidity$/))
        await screen.settle()

        assert.equal(stub.sent.length, 2)
        assert.equal(stub.sent[0]?.to.toLowerCase(), HEARTH.router.toLowerCase())
        assert.equal(stub.sent[1]?.to.toLowerCase(), HEARTH.router.toLowerCase())
        assert.notEqual(
          stub.sent[0]?.data.slice(0, 10),
          stub.sent[1]?.data.slice(0, 10),
          'unwrapping and not unwrapping went to the same router function',
        )
        // Nothing is sent as value on a withdrawal in either shape: the coins come OUT.
        assert.equal(BigInt(stub.sent[0]?.value ?? '0x1'), 0n)
        assert.equal(BigInt(stub.sent[1]?.value ?? '0x1'), 0n)
      },
      stub,
    )
  })

  it('says there is nothing of yours here, rather than offering a withdrawal of zero', async () => {
    await page(
      withPosition({ balances: {} }),
      REMOVE,
      async (screen) => {
        assert.match(screen.text(), /You hold none of this pool/)
        assert.match(screen.text(), /There is nothing of yours in this pool to withdraw/)
        assert.equal(screen.queryByRole('button', /^Remove liquidity$/), null)
      },
      wallet(),
    )
  })
})

describe('creating a market', () => {
  const both = (options: Parameters<typeof chain>[0] = {}): ChainFixture =>
    chain({ pairs: [EMBER_NEFELI, EMBER_SILT], ...options })

  it('OFFERS A REAL BUTTON, because the deployed factory checks no caller', async () => {
    // Verified against the deployed factories on 7411 and 7412 rather than read off the source:
    // `createPair` `eth_call`ed from an address with no relationship to this project answered with
    // a pair address on both. A button that always failed would be worse than no button.
    const stub = wallet()
    await page(
      both(),
      '/pools/new',
      async (screen) => {
        assertMounted(screen)
        await screen.type(screen.byRole('textbox', 'First token address'), NEFELI.address)
        await screen.settle()
        await screen.type(screen.byRole('textbox', 'Second token address'), SILT.address)
        await screen.settle()

        // The address it would have, derived by CREATE2 in this browser — known before the
        // transaction is sent, which is what makes the link to the deposit page honest.
        const derived = pairFor(HEARTH, NEFELI.address, SILT.address)
        assert.match(screen.text(), new RegExp(derived.slice(2, 12), 'i'))
        assert.match(screen.text(), /Anybody\. The factory charges no fee for this/)
        assert.match(screen.text(), /keeps no allowlist, on both Hearth chains/)
        // And what it would hold, which is the part somebody about to spend gas has to hear.
        assert.match(screen.text(), /Nothing\. A new pair has no reserves/)

        await screen.click(screen.byRole('button', 'Create this market'))
        await screen.settle()
        assert.equal(stub.sent.length, 1)
        assert.equal(stub.sent[0]?.to.toLowerCase(), HEARTH.factory.toLowerCase())
        assert.equal(BigInt(stub.sent[0]?.value ?? '0x1'), 0n)
        assert.match(screen.text(), /New pool/)
      },
      stub,
    )
  })

  it('LINKS TO THE MARKET THAT ALREADY EXISTS instead of offering a call that reverts', async () => {
    // `PAIR_EXISTS` is the one refusal of the three that cannot be seen from the two addresses
    // alone, so it is read from the factory before the button is drawn.
    await page(
      both(),
      '/pools/new',
      async (screen) => {
        await screen.type(screen.byRole('textbox', 'First token address'), NEFELI.address)
        await screen.settle()
        await screen.type(screen.byRole('textbox', 'Second token address'), WEMBER.address)
        await screen.settle()
        assert.match(screen.text(), /This market already exists/)
        assert.match(screen.text(), /The factory would refuse a second one/)
        assert.equal(screen.queryByRole('button', 'Create this market'), null)
      },
      wallet(),
    )
  })

  it('refuses the same token twice and the zero address, before any gas', async () => {
    // `withScreen` rather than `page`: the zero address has no contract behind it, so the token
    // read against it is a read that fails — which is the subject here, and would land in
    // `unmodelled` as the fixture's honest report that nothing is deployed there.
    const stub = wallet()
    const options = {
      url: `${AT}/pools/new`,
      routes: both().routes,
      windowExtras: { ethereum: stub.provider },
    }
    await withScreen(app(), options, async (screen) => {
      await screen.settle()
      await screen.type(screen.byRole('textbox', 'First token address'), NEFELI.address)
      await screen.type(screen.byRole('textbox', 'Second token address'), NEFELI.address)
      await screen.settle()
      assert.match(screen.text(), /A pool holds two different tokens/)
      assert.equal(screen.queryByRole('button', 'Create this market'), null)

      await screen.type(
        screen.byRole('textbox', 'Second token address'),
        '0x0000000000000000000000000000000000000000',
      )
      await screen.settle()
      assert.match(screen.text(), /The zero address is not a token/)
      assert.equal(screen.queryByRole('button', 'Create this market'), null)
      assert.equal(stub.sent.length, 0)
    })
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

describe('the receipts page', () => {
  /**
   * The chain that carries them. `chain()` defaults to 7411, which has no receipt — so every
   * scenario here that wants one says so, and the ones that want the absence say nothing.
   *
   * BOTH RECEIPTS ARE MODELLED IN EVERY SCENARIO, and a scenario that varies one still passes the
   * other. The page renders every row `src/lib/receipts.ts` holds for the chain, not the rows this
   * fixture happens to answer for, so leaving one out does not remove it from the page — it puts a
   * "could not be read" card on it and fills `unmodelled` with the calls it made trying.
   */
  const withReceipts = (options: Parameters<typeof chain>[0] = {}) =>
    chain({ chainId: RECEIPT_CHAIN_ID, receipts: [FLTC, DEMBER], ...options })

  /**
   * A verdict, anchored to the question it answers.
   *
   * `screen.text()` runs the two together — `…been paid?All settled` — and anchoring is not
   * pedantry here: the words "fresh" and "covered" both appear in the prose explaining the checks,
   * so an unanchored `/Fresh/` passes against a page showing `Stale` and the sentence "until a
   * fresh reserve is attested".
   */
  const answers = (question: string, verdict: string): RegExp =>
    new RegExp(`${question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?${verdict}`)

  const COVERED = 'covered by the attested reserve'
  const FRESH = 'fresh enough to authorise issuing more'
  const PAID = 'Has everyone who redeemed actually been paid'

  it('SAYS WHOSE PROMISE IT IS BEFORE IT SAYS ANYTHING ELSE', async () => {
    // The page's whole reason for being separate from `/contracts`. Every other route on this
    // surface can say nobody can take your coins; this one has to say the opposite, in the first
    // screenful, in its own voice rather than in a footnote under the numbers.
    await page(withReceipts(), '/receipts', async (screen) => {
      assertMounted(screen)
      const text = screen.text()
      assert.match(text, /holding a receipt means trusting CloudsForge to still have it/)
      assert.match(text, /This one is a promise, and the rest of this surface is not/)
      assert.match(text, /It cannot make the promise good\. It makes breaking it a matter of record/)
      // Read off the token, not written here — so a wallet showing fLTC shows the same sentence.
      assert.match(text, /This is a promise by CloudsForge, not a trustless peg/)
      screen.before(
        'This one is a promise, and the rest of this surface is not',
        'What the contract says it is',
        'the custody warning has to come before the figures it qualifies',
      )
    })
  })

  it('prints the coverage, freshness and settlement checks as words, with both sides', async () => {
    const fixture = withReceipts()
    await page(fixture, '/receipts', async (screen) => {
      const text = screen.text()
      assert.match(text, answers(COVERED, 'Fully covered'))
      assert.match(text, answers(FRESH, 'Fresh'))
      // fLTC has never been redeemed from; the drill has been, and was settled.
      assert.match(text, answers(PAID, 'Nothing to check'))
      assert.match(text, answers(PAID, 'All settled'))
      assert.doesNotMatch(text, answers(PAID, 'Unpaid'))

      // Eight decimals, not eighteen: the fixture says so and the page reads it. A page that
      // assumed eighteen would print this reserve ten orders of magnitude wrong.
      assert.match(text, /0 LTC/)
      assert.ok(
        ethCalls(screen.api.wire).some((c) => c.to === FLTC.address && c.fn === 'coverage'),
        'the page printed a coverage verdict without calling coverage()',
      )
    })
  })

  it('SHOWS THE SETTLED TXID, AND NOT THE ASCII THE DEPLOY SCRIPT PRINTED', async () => {
    // The shipped bug, reproduced as a fixture and asserted against. `redemption(uint256)` returns
    // `(address, uint256, string, uint64, bytes32)`, so the data ENDS in the middle of the payout
    // address and its last word is text. Reading from the end printed a settled txid of
    // `0x6338643261353264623500…` — the ASCII of the last ten characters of the payout address —
    // and reported a failure against a settlement that was correct on chain.
    const txid = DEMBER.redemptions[0]?.settledTxid ?? ''
    await page(withReceipts(), '/receipts', async (screen) => {
      const text = screen.text()
      assert.match(text, new RegExp(txid, 'i'))
      assert.match(text, /a transaction on Hearth Testnet itself/)
      // The payout address, as itself, in its own column — not smeared into the txid.
      assert.match(text, new RegExp(HOLDER, 'i'))
      assert.doesNotMatch(text, /Burnt, not yet paid/)
    })
  })

  it('names the drill a test instrument, in the heading, not in a footnote', async () => {
    await page(withReceipts(), '/receipts', async (screen) => {
      assert.match(screen.text(), /Test instrument — do not hold/)
      assert.match(screen.text(), /Nobody should hold one/)
      // And the issued receipt is not labelled with it.
      assert.match(screen.text(), /Issued receipt/)
    })
  })

  it('reads the reserve addresses off the contract and gives the command to count them', async () => {
    await page(withReceipts(), '/receipts', async (screen) => {
      const text = screen.text()
      for (const address of FLTC.reserveAddresses) {
        assert.match(text, new RegExp(address), `${address} was not published on the page`)
      }
      assert.match(text, /scantxoutset start/)
      assert.match(text, /no wallet, no import, no index, and nothing of ours in the path/)
      // The drill's underlying is this chain's own coin, so no Litecoin command is printed for it.
      assert.match(text, /the check is a balance read on the explorer/)
    })
  })

  it('CALLS A STALE ATTESTATION STALE, judged by the chain and not by this browser', async () => {
    // The attestation is older than `maxAttestationAge`, so `coverage()`'s own `fresh` word is
    // false. The page prints the contract's answer rather than doing the arithmetic itself — which
    // is what makes it the same answer the issue path gets.
    const fixture = withReceipts({ now: CHAIN_NOW + 200_000 })
    await page(fixture, '/receipts', async (screen) => {
      assert.match(screen.text(), answers(FRESH, 'Stale'))
      assert.match(screen.text(), /refuse to mint anything until it is/)
      assert.doesNotMatch(screen.text(), answers(FRESH, 'Fresh'))
      // Stale is not a shortfall, and the page keeps the two apart: what is issued is still fully
      // covered by the last figure recorded, which is a different sentence from "it is enough now".
      assert.match(screen.text(), answers(COVERED, 'Fully covered'))
    })
  })

  it('LEAVES AN UNPAID REDEMPTION VISIBLE, as burnt supply with nothing recorded against it', async () => {
    const owing: FixtureReceipt = {
      ...DEMBER,
      redemptions: [{ ...(DEMBER.redemptions[0] as FixtureRedemption), settledTxid: null }],
    }
    await page(withReceipts({ receipts: [FLTC, owing] }), '/receipts', async (screen) => {
      const text = screen.text()
      assert.match(text, answers(PAID, 'Unpaid'))
      assert.match(text, /Burnt, not yet paid/)
      assert.match(text, /is owed and has not been recorded as paid/)
    })
  })

  it('refuses to fall back to a list of its own when no reserve address is published', async () => {
    // With none published there is no way to check the backing without asking CloudsForge — which
    // is the position the whole design exists to avoid, so the page says that rather than going
    // quiet or reaching for a constant of its own.
    const unpublished: FixtureReceipt = { ...FLTC, reserveAddresses: [] }
    await page(withReceipts({ receipts: [unpublished, DEMBER] }), '/receipts', async (screen) => {
      assert.match(screen.text(), /The contract publishes no reserve addresses/)
      assert.match(screen.text(), /the issuer’s unverifiable claim that it is/)
    })
  })

  it('reports a receipt that would not answer as a FAULT IN THE READING, not as a shortfall', async () => {
    const broken = withReceipts({ refuses: ['eth_call'] })
    await withScreen(app(), { url: `${AT}/receipts`, routes: broken.routes }, async (screen) => {
      await screen.settle()
      assert.match(screen.text(), /fLTC could not be read/)
      assert.match(screen.text(), /a fault in the reading, not a finding about the reserve/)
      assert.doesNotMatch(screen.text(), /Short/)
      assert.doesNotMatch(screen.text(), /Fully covered/)
    })
  })

  it('RENDERS THE MAINNET ABSENCE AS A MEASUREMENT, AND MAKES NO eth_call FOR IT', async () => {
    // Forge Network carries no receipt, and that is a reading rather than a gap: the addresses
    // custody holds Litecoin at were scanned, the total came back zero, and nothing was deployed.
    // "Coming soon" would turn a deliberate refusal into an unfinished feature.
    const fixture = chain()
    await page(fixture, '/receipts', async (screen) => {
      const text = screen.text()
      assert.match(text, /There is no LTC receipt on this network, and that was measured/)
      assert.match(text, /a receipt issued against nothing is the one thing this design refuses/)
      assert.match(text, /#3,161,029/)
      assert.match(text, /0x9173116ba259641a250352ad99dfcdf3a49a996e9cbc1cf3976c313ad1a785eb/)
      assert.match(text, /2026-08-16/)
      assert.match(text, /scantxoutset start/)
      assert.doesNotMatch(text, /coming soon/i)
      // There is no contract to read, so nothing was read. A page that called anyway would be
      // reporting a deliberate absence as an outage — micro-org#406, on a different console.
      assert.deepEqual(
        ethCalls(screen.api.wire),
        [],
        'the page asked the chain about a receipt that does not exist on it',
      )
    })
  })

  it('points at the network that DOES publish the addresses, derived rather than written', async () => {
    await page(chain(), '/receipts', async (screen) => {
      assert.match(screen.text(), /published on chain by the fLTC contract/)
      assert.match(screen.text(), new RegExp(String(RECEIPT_CHAIN_ID)))
      assert.match(screen.text(), /Switch networks in the header above to read them there/)
      // And the addresses themselves are NOT on this page, on either network — the promise this
      // page makes about not baking custody addresses into a bundle.
      for (const address of FLTC.reserveAddresses) {
        assert.doesNotMatch(screen.text(), new RegExp(address))
      }
    })
  })

  it('distinguishes a network nobody has measured from one that was measured empty', async () => {
    await page(chain({ chainId: OTHER_CHAIN_ID }), '/receipts', async (screen) => {
      assert.match(screen.text(), /No receipt has been measured on this network/)
      assert.match(screen.text(), /it is the absence of anyone having looked/)
      assert.doesNotMatch(screen.text(), /and that was measured/)
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
    for (const path of [
      '/',
      '/pools',
      `/pools/${EMBER_NEFELI.address}`,
      `/pools/${EMBER_NEFELI.address}/add`,
      `/pools/${EMBER_NEFELI.address}/remove`,
      '/pools/positions',
      '/pools/new',
      '/receipts',
      '/contracts',
    ]) {
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
