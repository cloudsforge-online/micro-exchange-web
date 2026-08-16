/**
 * The arithmetic a swap obeys, and the deployment table it obeys it against.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THESE ARE CHECKS AGAINST THE DEFINITION. NOBODY HAS REPLAYED A MAINNET SWAP INTO THIS FILE.
 *
 * The distinction matters enough to lead with. A vector labelled "measured on chain 7411" is worth
 * far more than one evaluated from the formula — it catches the case where this repository and the
 * deployed contracts disagree, which is the only case that costs a reader money. A vector merely
 * SAID to be measured is worth less than nothing, because it retires the suspicion that would have
 * sent somebody to go and check.
 *
 * So the vectors below are evaluated from `UniswapV2Library`'s own formulae in exact integer
 * arithmetic, by hand, and they are labelled as that. What they catch is this file drifting from
 * the reference implementation: a fee written 998/1000, a `+ 1n` dropped from `getAmountIn`, a
 * numerator and denominator swapped. What they cannot catch is `feeTo` being switched on at the
 * factory, which changes nothing here — the 0.3% is taken from the input either way; the protocol
 * share comes out of the LP's cut — or a router that is not V2 at all.
 *
 * The second thing is caught anyway, and not by a vector: `swap.tsx` quotes with the ROUTER's
 * `getAmountsOut` and fills at the router's number. These functions exist to plot a curve, which is
 * a hundred quotes and would otherwise be a hundred round trips. So a divergence between this file
 * and the chain shows up on the page as a curve that misses the dot on it, which is visible, rather
 * than as a fill the reader did not expect, which is not.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── THE INVARIANT TESTS ARE THE LOAD-BEARING ONES ─────────────────────────────────────────────
 *
 * A vector pins one point. `k` never falling, and every rounding going the pool's way, are
 * properties that hold at every point — and they are the properties an off-by-one actually breaks.
 * A `getAmountOut` that rounded UP by one wei would pass a spot check against a formula somebody
 * re-derived the same wrong way, and would drain a pool one wei per trade until the invariant broke.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  constantProduct,
  curvePoints,
  DEPLOYMENTS,
  deploymentFor,
  FEE_DENOMINATOR,
  FEE_NUMERATOR,
  getAmountIn,
  getAmountOut,
  minimumOut,
  pairFor,
  priceImpactBps,
  quote,
  sortTokens,
} from '../src/lib/dex.ts'

/** A round pool, in wei, on both sides. 1,000 of one token against 4,000,000 of the other. */
const RESERVE_IN = 1_000n * 10n ** 18n
const RESERVE_OUT = 4_000_000n * 10n ** 18n
const ONE = 10n ** 18n

test('THE FEE IS 0.3%, TAKEN FROM THE INPUT, AND IT IS TWO INTEGERS', () => {
  // Not `0.003`. A float fee is the classic way a port of this arithmetic acquires a rounding error
  // that only shows up at scale: 997/1000 is exact at every magnitude, `1 - 0.003` is not.
  assert.equal(FEE_NUMERATOR, 997n)
  assert.equal(FEE_DENOMINATOR, 1000n)
  assert.equal(typeof FEE_NUMERATOR, 'bigint')
  assert.equal(typeof FEE_DENOMINATOR, 'bigint')
})

test('getAmountOut matches the reference formula, evaluated exactly', () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // One token in, against reserves of 1,000 and 4,000,000. The no-trade price is 4,000; the fill is
  // a little under it, and the whole of the difference is the fee plus this trade's own impact.
  //
  //   amountInWithFee = 1e18 · 997                     = 997000000000000000000
  //   numerator       = amountInWithFee · 4e24         = 3988e42
  //   denominator     = 1e21 · 1000 + amountInWithFee  = 1000997000000000000000000
  //   out             = numerator / denominator, trunc = 3984027924159612865972
  //
  // The final figure is written out as a literal rather than recomputed with the same expression
  // the function uses, which would assert only that the line had been copied correctly.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const out = getAmountOut(ONE, RESERVE_IN, RESERVE_OUT)
  assert.equal(out, 3984027924159612865972n)
  // Just under 3,984 whole tokens against a no-trade price of 4,000 — 0.3% of which is the fee.
  assert.ok(out! < 4000n * ONE && out! > 3980n * ONE)

  // And a trade of a tenth the size gets slightly MORE than a tenth of the output, because it moves
  // the price less. A function that returned a proportional answer would be a linear quote wearing
  // a constant-product name — and would read as correct on a small pool.
  const tenth = getAmountOut(ONE / 10n, RESERVE_IN, RESERVE_OUT)
  assert.ok(tenth !== null && out !== null)
  assert.ok(tenth * 10n > out, 'the quote is linear; that is not a constant-product curve')
})

test('THE POOL WINS EVERY ROUNDING, WHICH IS WHAT KEEPS k FROM FALLING', () => {
  // The invariant the entire design rests on: after a swap, `x·y` must be at least what it was.
  // Integer division truncating DOWN on the output is what guarantees it, and an implementation
  // that rounded the output up by one wei would pass a spot check and drain the pool by a wei a
  // trade. Checked across magnitudes because a one-wei error is invisible at any single one.
  for (const amountIn of [1n, 7n, ONE / 1000n, ONE, ONE * 137n, RESERVE_IN / 2n]) {
    const out = getAmountOut(amountIn, RESERVE_IN, RESERVE_OUT)
    assert.ok(out !== null, `no quote for ${amountIn}`)
    const before = constantProduct(RESERVE_IN, RESERVE_OUT)
    const after = constantProduct(RESERVE_IN + amountIn, RESERVE_OUT - out)
    assert.ok(after >= before, `k fell on an input of ${amountIn} wei: ${before} → ${after}`)
  }
})

test('getAmountIn is the inverse of getAmountOut, rounded the other way', () => {
  // V2 adds one to `getAmountIn`'s truncated division deliberately: the reader must put in at least
  // enough, and "at least" with integer division means rounding up. So the round trip comes back to
  // the same output or to a hair more, NEVER to less — a `getAmountIn` missing the `+ 1n` produces
  // a transaction that reverts on the router's own check, costing gas and explaining nothing.
  for (const amountOut of [ONE, ONE * 500n, ONE * 12_345n, RESERVE_OUT / 4n]) {
    const needed = getAmountIn(amountOut, RESERVE_IN, RESERVE_OUT)
    assert.ok(needed !== null, `no answer for an output of ${amountOut}`)
    const back = getAmountOut(needed, RESERVE_IN, RESERVE_OUT)
    assert.ok(back !== null)
    assert.ok(back >= amountOut, `${needed} in yields ${back}, short of the ${amountOut} asked for`)
    // And not wastefully more: one wei less of input must fall short. This is what proves the
    // answer is the MINIMUM rather than merely a sufficient one.
    const short = getAmountOut(needed - 1n, RESERVE_IN, RESERVE_OUT)
    assert.ok(short !== null && short < amountOut, 'the answer is not the minimum input')
  }
})

test('a pool cannot be emptied at any price', () => {
  // The asymptote, and the one case where "no answer" is the only honest answer rather than a large
  // number. A frontend that quoted a finite input for the whole reserve would be quoting a trade
  // that reverts — `getAmountOut` on the other side can never reach `reserveOut`.
  assert.equal(getAmountIn(RESERVE_OUT, RESERVE_IN, RESERVE_OUT), null)
  assert.equal(getAmountIn(RESERVE_OUT + 1n, RESERVE_IN, RESERVE_OUT), null)
  assert.ok(getAmountIn(RESERVE_OUT - 1n, RESERVE_IN, RESERVE_OUT) !== null)
  // And however large the input, the output stays strictly under the reserve.
  const huge = getAmountOut(RESERVE_IN * 10_000n, RESERVE_IN, RESERVE_OUT)
  assert.ok(huge !== null && huge < RESERVE_OUT)
})

test('AN EMPTY OR ABSENT SIDE HAS NO PRICE, AND NULL IS NOT ZERO', () => {
  // `0` renders as a price. "No answer" renders as "there is no pool for this pair", which is the
  // true sentence — and on a surface where the next thing the reader does is sign something, a
  // quote of zero beside a Swap button is the worst available output.
  for (const [amountIn, rIn, rOut] of [
    [ONE, 0n, RESERVE_OUT],
    [ONE, RESERVE_IN, 0n],
    [0n, RESERVE_IN, RESERVE_OUT],
    [-1n, RESERVE_IN, RESERVE_OUT],
  ] as const) {
    assert.equal(getAmountOut(amountIn, rIn, rOut), null)
    assert.equal(quote(amountIn, rIn, rOut), null)
    assert.equal(priceImpactBps(amountIn, rIn, rOut), null)
  }
  assert.equal(curvePoints(0n, RESERVE_OUT).length, 0)
  assert.equal(curvePoints(RESERVE_IN, 0n).length, 0)
})

test('quote is the no-trade price: reserves only, no fee', () => {
  // The line the curve is tangent to, and the number price impact is measured against. Applying the
  // fee here would understate the impact by exactly the fee, which is how a frontend reports 0.0%
  // impact on a trade that moved the price.
  assert.equal(quote(ONE, RESERVE_IN, RESERVE_OUT), 4000n * ONE)
  assert.ok(quote(ONE, RESERVE_IN, RESERVE_OUT)! > getAmountOut(ONE, RESERVE_IN, RESERVE_OUT)!)
})

test('PRICE IMPACT INCLUDES THE FEE, AND IS MONOTONIC IN THE SIZE OF THE TRADE', () => {
  // A trade of nothing still costs the fee, so impact tends to 30bp rather than to zero as the size
  // falls — and a reader who sees "0.30%" on a dust trade is reading something true. It only rises
  // from there. A non-monotonic impact would mean the page tells somebody a bigger trade is cheaper.
  const sizes = [ONE / 1000n, ONE, ONE * 10n, ONE * 100n, RESERVE_IN / 10n]
  const impacts = sizes.map((s) => priceImpactBps(s, RESERVE_IN, RESERVE_OUT))
  for (const bps of impacts) assert.ok(bps !== null && bps >= 29)
  for (let i = 1; i < impacts.length; i += 1) {
    assert.ok(impacts[i]! >= impacts[i - 1]!, 'a larger trade reported a smaller impact')
  }
  // A tenth of the pool is a very expensive trade and the number has to say so out loud, rather
  // than rounding into the same "0.3%" the dust trade got.
  assert.ok(impacts[impacts.length - 1]! > 900, 'a 10%-of-pool trade did not report a large impact')
})

test('the minimum output rounds DOWN, and zero tolerance means no reduction', () => {
  // Rounding a minimum UP is a swap that reverts for a reader who set an exact tolerance. And a
  // tolerance of zero must pass the number through untouched rather than through a division that
  // shaves a wei — the reader asked for exactly this fill or none.
  assert.equal(minimumOut(1000n, 0), 1000n)
  assert.equal(minimumOut(1000n, 50), 995n)
  // A dust output with a tolerance on it rounds to nothing, and that is correct rather than a bug
  // to special-case: `amountOutMin: 0` is what the reader asked for when they said "one wei, give
  // or take 0.5%" — the router has no smaller unit to hold them to.
  assert.equal(minimumOut(1n, 50), 0n)
  assert.equal(minimumOut(3n, 3333), 2n)
  for (const bps of [1, 10, 50, 100, 500]) {
    const out = 7_777_777_777_777_777_777n
    assert.ok(minimumOut(out, bps) <= (out * BigInt(10_000 - bps)) / 10_000n)
  }
})

test('the curve is a hyperbola through the current reserves, not a straight line', () => {
  const points = curvePoints(RESERVE_IN, RESERVE_OUT, 32)
  assert.equal(points.length, 32)
  // x rises, y falls, and every point is on `x·y = k`. Checked as a ratio because these are floats
  // by design — an SVG coordinate is a float, and the conversion happens here so `Number()` stays
  // out of every consumer, where it would eventually be applied to a balance rather than a pixel.
  const k = Number(RESERVE_IN) * Number(RESERVE_OUT)
  for (let i = 0; i < points.length; i += 1) {
    assert.ok(Math.abs((points[i]!.x * points[i]!.y) / k - 1) < 1e-9, 'a point is off the curve')
    if (i > 0) {
      assert.ok(points[i]!.x > points[i - 1]!.x)
      assert.ok(points[i]!.y < points[i - 1]!.y)
    }
  }
  // The window is `[reserveIn/8, reserveIn·4]`. Not `[0, ∞)`: near either axis the branch is
  // visually a straight line along it, and a plot spending most of its width on the asymptotes says
  // nothing about the region a real trade moves through.
  assert.ok(Math.abs(points[0]!.x - Number(RESERVE_IN) / 8) < 1)
  assert.ok(Math.abs(points[points.length - 1]!.x - Number(RESERVE_IN) * 4) < 1)
  // Two samples is the floor; fewer is not a curve and returns nothing rather than a segment.
  assert.equal(curvePoints(RESERVE_IN, RESERVE_OUT, 1).length, 0)
})

test('TOKENS SORT BY UNSIGNED NUMERIC VALUE, NOT BY THE STRING', () => {
  // The bug this exists to prevent: `'0x9…' < '0xa…'` is true as a string and true numerically, so
  // a lexicographic sort looks right on most inputs and is wrong on mixed case. The factory enforces
  // `token0 < token1` numerically; getting it wrong here inverts every price this surface prints,
  // which is not a display bug — it is a reader selling at the reciprocal of the rate they read.
  const lower = '0x0000000000000000000000000000000000000001'
  const upper = '0xFFFFfFfFffFFfFFfffFFFfffFfFffFfFFfFfFFfF'
  assert.deepEqual(sortTokens(upper, lower), [lower, upper.toLowerCase()])
  assert.deepEqual(sortTokens(lower, upper), [lower, upper.toLowerCase()])
  // Case is normalised on the way out, so a checksummed address and a lower-case one produce the
  // same salt — and therefore the same CREATE2 address — rather than two different pairs.
  const mixed = '0x4B1D0a7F39c8E25d6b04Fa17C3e9825D0f6A1b4C'
  assert.deepEqual(sortTokens(mixed, lower), [lower, mixed.toLowerCase()])
  // And the order is stable when both are the same address, rather than throwing. The factory
  // refuses to create such a pair; this function is not the place that decision belongs.
  assert.deepEqual(sortTokens(lower, lower), [lower, lower])
})

test('THE DEPLOYMENT TABLE IS KEYED BY CHAIN ID, AND HAS EXACTLY THE CHAINS IT HAS', () => {
  // Chain 7411 is Hearth mainnet. Hearth TESTNET has no Forge Exchange — phase F was mainnet-only
  // and deliberately so — and a speculative testnet row here would render a swap form against
  // contracts that are not there. `null` is a state this surface renders as a sentence.
  assert.deepEqual(DEPLOYMENTS.map((d) => d.chainId), [7411])
  assert.equal(deploymentFor(7411)?.chainName, 'Hearth')
  assert.equal(deploymentFor(7412), null)
  assert.equal(deploymentFor(1), null)
  assert.equal(deploymentFor(null), null)

  // Every address is lower-case hex of the right length. A checksummed one would compare unequal to
  // what the node returns from `getPair()`, which is how a page reports a canonical pair as an
  // impostor — the worst possible direction for that particular warning to fail in.
  for (const d of DEPLOYMENTS) {
    for (const [field, value] of Object.entries(d)) {
      if (typeof value !== 'string' || !value.startsWith('0x')) continue
      const width = field === 'initCodeHash' ? 66 : 42
      assert.equal(value.length, width, `${field} is not ${width} characters`)
      assert.equal(value, value.toLowerCase(), `${field} is checksummed; the node answers lower-case`)
    }
    // The blocks exist so an auditor can find the deployment transaction and read the constructor
    // arguments — which is the check that `feeToSetter` is a multisig rather than one hot key.
    assert.equal(typeof d.blocks.factory, 'number')
    assert.equal(typeof d.blocks.router, 'number')
  }
})

test('THE TABLE IS FROZEN, SO NOTHING CAN RE-POINT THE ROUTER AT RUNTIME', () => {
  // This is the address the surface asks a reader to sign an approval to. A mutable module-scope
  // table is one cross-site script away from being a different address by the time the reader
  // presses the button — and the page would still render the audited one beside it.
  assert.ok(Object.isFrozen(DEPLOYMENTS))
  for (const d of DEPLOYMENTS) assert.ok(Object.isFrozen(d))
})

test('pairFor derives the same address for either argument order', () => {
  // CREATE2 salts on the SORTED pair, so `pairFor(a, b)` and `pairFor(b, a)` are the same pool.
  // They are also the same pool as the checksummed spelling of either.
  const hearth = deploymentFor(7411)!
  const a = '0x4b1d0a7f39c8e25d6b04fa17c3e9825d0f6a1b4c'
  const b = hearth.wrapped
  const derived = pairFor(hearth, a, b)
  assert.match(derived, /^0x[0-9a-f]{40}$/)
  assert.equal(pairFor(hearth, b, a), derived)
  assert.equal(pairFor(hearth, a.toUpperCase().replace('0X', '0x'), b), derived)
  // And a different pair is a different address — a derivation that ignored its arguments would
  // pass every assertion above.
  assert.notEqual(pairFor(hearth, a, '0x9c2e7f10a4b83d6e5f0192c7ab34de56f7890a1b'), derived)
})

test('THE DERIVATION FOLLOWS THE FACTORY AND THE INIT CODE HASH, NOT A CONSTANT', () => {
  // Trap 1 from the plan. The router hard-codes an `INIT_CODE_HASH`; a fork that recompiled the pair
  // without updating it sends every swap to an address with no code, and `getPair()` still answers
  // correctly, so the failure surfaces as a revert on the first real trade. `contracts.tsx` shows
  // the derivation beside the factory's own answer so a READER can make that check.
  //
  // Which means this function has to actually consume both inputs. A derivation that ignored the
  // hash would print two addresses that always agree — a check that can never fail, on the page
  // whose entire purpose is that it can.
  const hearth = deploymentFor(7411)!
  const a = hearth.wrapped
  const b = '0x4b1d0a7f39c8e25d6b04fa17c3e9825d0f6a1b4c'
  const base = pairFor(hearth, a, b)
  const otherHash = { ...hearth, initCodeHash: `0x${'11'.repeat(32)}` }
  const otherFactory = { ...hearth, factory: `0x${'22'.repeat(20)}` }
  assert.notEqual(pairFor(otherHash, a, b), base)
  assert.notEqual(pairFor(otherFactory, a, b), base)
})
