/**
 * The exchange itself: where the contracts are, how a pair address is derived, and the arithmetic
 * a swap obeys.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEPLOYMENT TABLE IS KEYED BY `eth_chainId`, NOT BY HOSTNAME AND NOT BY A BUILD FLAG.
 *
 * A chain id is the one fact that cannot lie about which contracts are in front of you. A hostname
 * can be re-pointed, an environment variable can be stale, a build argument makes the artefact CI
 * examined a different artefact from the one that ships (`test/no-build-time-config.test.ts`). The
 * id is read from the node this page is actually talking to, on every load, and the table is
 * consulted with the answer.
 *
 * So `deploymentFor()` returning `null` is a first-class state and the page renders it as a
 * sentence rather than an error: this network does not run Forge Exchange. That is the whole of
 * micro-pool-web's `deployment.json` mechanism, obtained here for free — the pool needed a document
 * from its container because "is micro-pool deployed" is not visible from the browser, whereas
 * "are these contracts on this chain" is visible by definition. There is no `deployment.inc`
 * template in this repository for that reason.
 *
 * ── THE ADDRESSES BELOW ARE NOT SECRETS AND NOT CONFIGURATION ────────────────────────────────
 *
 * They are the immutable identity of deployed code. `test/no-build-time-config.test.ts` forbids a
 * CloudsForge HOSTNAME in `src/` because one image serves localhost, a preview and two estates; a
 * contract address is the opposite kind of fact — chain 7411 has exactly one Forge Exchange
 * factory, on every host that ever serves this bundle, forever. Writing them down is what lets a
 * reader check them against the explorer, which is the point of §7 of the plan.
 *
 * Each carries the block it was mined in, because that is the number an auditor needs to find the
 * deployment transaction and read the constructor arguments — the check that trap 2 (`feeToSetter`
 * is a multisig) actually passed.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { keccak256, toHex0x } from './keccak.ts'

export interface Deployment {
  /** The chain, as the node reports it. */
  readonly chainId: number
  /** What to call this chain on screen. */
  readonly chainName: string
  /** The native coin's ticker — what a balance with no contract behind it is denominated in. */
  readonly nativeSymbol: string
  /** UniswapV2Factory. Every pair on this chain was created by it and can be derived from it. */
  readonly factory: string
  /** UniswapV2Router02. The only contract this surface ever asks a reader to sign for. */
  readonly router: string
  /** The wrapped native coin the router unwraps through. */
  readonly wrapped: string
  /**
   * The `keccak256` of `UniswapV2Pair`'s creation code, as the factory reports it.
   *
   * TRAP 1 FROM THE PLAN, WRITTEN DOWN SO THE PAGE CAN CHECK IT RATHER THAN ASSERT IT. The V2
   * router derives a pair's address with CREATE2 from this constant, so a constant that does not
   * match the factory's real bytecode hash sends every swap to an address with no code — which
   * reverts, on a good day. `contractsPage` re-derives a live pair from this hash and compares the
   * result with `factory.getPair()`, in the reader's own browser, and shows both.
   */
  readonly initCodeHash: string
  /** The Multicall3 deployment, for batching reads. Null where none is deployed. */
  readonly multicall: string | null
  /** The block each of the above was mined in, for looking the deployment up on the explorer. */
  readonly blocks: Readonly<Record<'factory' | 'router' | 'wrapped' | 'multicall', number | null>>
}

/**
 * Every chain this surface knows the exchange on.
 *
 * TWO ENTRIES, and the honesty of the page depends on the list being exactly as long as the truth
 * is — in both directions. A row for a chain with no deployment renders a swap form against
 * contracts that are not there, and every quote on it fails. A MISSING row for a chain that does
 * have one tells a reader "Forge Exchange is not deployed on this network" about a market they can
 * see on the explorer, which is the same lie with the sign flipped, and it is the one this file
 * shipped with: the comment here said phase F was mainnet-only, and phase D had already put the
 * full set on 7412 four days earlier.
 *
 * Both rows were re-read from the node before being written down rather than copied out of a
 * deployment note (docs/ecosystem/39 §5 makes that the rule, and §6 phase E is what happens when
 * you do it): `factory.allPairsLength()`, `router.factory()`, `router.WETH()` and
 * `multicall3.getChainId()` all answer as below, and on each chain the one live pair recomputed by
 * CREATE2 from `initCodeHash` equals `factory.allPairs(0)` exactly — trap 1, checked rather than
 * asserted. The block numbers were found by bisecting `eth_getCode`, so they are the block each
 * address first had code in, not the block a script logged.
 *
 * The two deployments are NOT the same bytecode. 7412 predates the factory and multisig fixes from
 * §6 phase E; 7411 was deployed from `main` afterwards. `initCodeHash` is identical anyway, and has
 * to be — the pair contract did not change, and `bytecodeHash: 'none'` means editing the factory
 * cannot perturb it — which is why one constant serves both rows and why the derivation above still
 * lands on the deployed pair on each chain.
 */
export const DEPLOYMENTS: readonly Deployment[] = Object.freeze([
  Object.freeze({
    chainId: 7411,
    chainName: 'Hearth',
    nativeSymbol: 'EMBER',
    factory: '0x8e41e083cd664a5d65d047198338e5f110ee883f',
    router: '0x74a991fedb2e09aa23faffa9bdf4ca5dbbeb0527',
    wrapped: '0xdae7f901bc0ea6cb8a77c160e355007981e351e1',
    initCodeHash: '0x46b4122ae9db4a03c913cfbed4e6321064741545c60aafe3ed9410be7657a537',
    multicall: '0xe1636b08ff1edde24b2642a3cb388d4e97dfe0bc',
    blocks: Object.freeze({ factory: 38843, router: 38845, wrapped: 38841, multicall: 38847 }),
  }),
  Object.freeze({
    // Deployed 2026-08-11 from block 14121 (docs/ecosystem/39 §6 phase D; hearth/contracts/README).
    // The name is what the network switcher calls this chain everywhere else in the estate, so a
    // reader who arrived through the switcher sees the word they pressed.
    chainId: 7412,
    chainName: 'Hearth Testnet',
    nativeSymbol: 'EMBER',
    factory: '0x18bbd09d51f4e9e630dd0a86fc984b6326f10e41',
    router: '0xba2b9db822e1f2ec3039fe474644b8405268a9b4',
    wrapped: '0xa26dfebc362a380e1ade6090c7c5887180d1b263',
    initCodeHash: '0x46b4122ae9db4a03c913cfbed4e6321064741545c60aafe3ed9410be7657a537',
    multicall: '0x76db8cdcaf4a517a51ae474bd00cfe9a53635c03',
    blocks: Object.freeze({ factory: 14122, router: 14124, wrapped: 14121, multicall: 14128 }),
  }),
])

/** The deployment on a chain, or null. Null is a rendered state, not an error. */
export function deploymentFor(chainId: number | null): Deployment | null {
  if (chainId === null) return null
  return DEPLOYMENTS.find((d) => d.chainId === chainId) ?? null
}

/**
 * The two tokens of a pair, in the order the pair itself stores them.
 *
 * `token0 < token1` by unsigned address comparison, which the factory enforces at creation. Every
 * reserve read has to be un-sorted against this or the price comes out inverted — and an inverted
 * price on a swap form is not a display bug, it is a reader selling at the reciprocal of the rate
 * they read.
 */
export function sortTokens(a: string, b: string): readonly [string, string] {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return BigInt(x) < BigInt(y) ? [x, y] : [y, x]
}

/**
 * A pair's address, derived in the browser — CREATE2, exactly as the router does it.
 *
 * ── WHY THIS IS HERE AT ALL, WHEN `factory.getPair()` EXISTS ─────────────────────────────────
 *
 * Because the two answers agreeing is the check that trap 1 passed, and it is a check a READER can
 * make rather than one this repository asserts on their behalf. §2 of the plan makes the point
 * bluntly: the V2 router hard-codes an `INIT_CODE_HASH`, and a fork that recompiled the pair
 * without updating it produces a router whose every swap goes to an address with no code. There is
 * no way to notice that from the factory alone — `getPair()` still answers correctly — so the
 * failure surfaces as a revert on the first real trade.
 *
 * `keccak256(0xff ++ factory ++ keccak256(token0 ++ token1) ++ initCodeHash)`, low 20 bytes. Pure,
 * synchronous, no node involved; `contracts.tsx` renders it beside the factory's own answer.
 */
export function pairFor(deployment: Deployment, tokenA: string, tokenB: string): string {
  const [token0, token1] = sortTokens(tokenA, tokenB)
  const salt = keccak256(hexBytes(token0.slice(2) + token1.slice(2)))
  const packed = hexBytes(
    'ff' + deployment.factory.slice(2) + toHex0x(salt).slice(2) + deployment.initCodeHash.slice(2),
  )
  return `0x${toHex0x(keccak256(packed)).slice(-40)}`
}

/** A hex run as bytes. Odd-length input is a programming error and throws rather than truncating. */
function hexBytes(hex: string): Uint8Array {
  const bare = hex.startsWith('0x') ? hex.slice(2) : hex
  if (bare.length % 2 !== 0) throw new RangeError('hex string of odd length')
  const out = new Uint8Array(bare.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(bare.slice(i * 2, i * 2 + 2), 16)
  return out
}

/* ── the constant-product arithmetic ───────────────────────────────────────────────────────────
 *
 * These are ports of `UniswapV2Library`, and they are here rather than being read off the router
 * for one reason: the page draws a CURVE, and a curve is a hundred quotes. Asking the node for a
 * hundred `getAmountsOut` calls to plot one line would be a hundred round trips for a picture.
 *
 * THE NUMBER THE READER ACTS ON IS STILL THE ROUTER'S. `swap.tsx` plots with these and quotes with
 * `getAmountsOut`, and shows the router's answer as the one that will be filled — because these
 * functions agreeing with the chain is exactly the sort of thing that is true until a fee parameter
 * changes.
 *
 * `test/dex.test.ts` pins them against vectors evaluated from `UniswapV2Library`'s own formulae in
 * exact integer arithmetic, and against the invariants those formulae exist to preserve: `k` never
 * falls, `getAmountIn` is the inverse of `getAmountOut` to within the rounding V2 specifies, and
 * every division truncates in the direction that favours the pool. Those are checks against the
 * DEFINITION, and they are deliberately not described as fills observed on chain — nobody has
 * replayed a mainnet swap into that file, and a comment claiming they had would be the most
 * expensive kind of wrong: it would retire the suspicion that makes somebody go and check.
 */

/** The 0.3% fee, as the numerator and denominator V2 uses. 997/1000, applied to the INPUT. */
export const FEE_NUMERATOR = 997n
export const FEE_DENOMINATOR = 1000n

/**
 * What comes out for a given input, against given reserves.
 *
 * Returns null for the cases where there is no answer rather than zero for them: a non-positive
 * input, or a reserve of zero on either side. An empty pool has no price, and `0` would render as
 * one.
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint | null {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null
  const amountInWithFee = amountIn * FEE_NUMERATOR
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee
  return numerator / denominator
}

/** What must go in to get a given output. Null where there is no answer, including an output the
 *  pool cannot pay: you cannot buy the whole reserve at any price, which is the curve's asymptote. */
export function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint | null {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null
  if (amountOut >= reserveOut) return null
  const numerator = reserveIn * amountOut * FEE_DENOMINATOR
  const denominator = (reserveOut - amountOut) * FEE_NUMERATOR
  return numerator / denominator + 1n
}

/** The marginal price with no trade — reserves only, no fee. The line the curve is tangent to. */
export function quote(amountA: bigint, reserveA: bigint, reserveB: bigint): bigint | null {
  if (amountA <= 0n || reserveA <= 0n || reserveB <= 0n) return null
  return (amountA * reserveB) / reserveA
}

/**
 * How far the fill sits below the no-trade price, in basis points.
 *
 * THIS IS PRICE IMPACT, AND IT IS NOT SLIPPAGE TOLERANCE. The two get conflated on every DEX
 * frontend and they are opposites: impact is what the reader's own trade does to the price, which
 * is certain and computable now; tolerance is how much OTHER people's trades may move it before the
 * reader would rather the transaction failed, which is a preference about an unknown future. This
 * page labels them with those words and never with the same word.
 *
 * Null when either quote is unavailable, and — deliberately — when the ideal is zero, which is a
 * pool too small to divide by rather than an impact of nothing.
 */
export function priceImpactBps(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): number | null {
  const ideal = quote(amountIn, reserveIn, reserveOut)
  const real = getAmountOut(amountIn, reserveIn, reserveOut)
  if (ideal === null || real === null || ideal === 0n) return null
  const bps = ((ideal - real) * 10_000n) / ideal
  return Number(bps)
}

/**
 * The minimum output to accept, given a tolerance in basis points.
 *
 * The router takes this as `amountOutMin` and reverts below it. Rounding is DOWN by integer
 * division, which is the safe direction: a minimum rounded up is a swap that reverts for a reader
 * who set an exact tolerance, and a revert costs gas and explains nothing.
 */
export function minimumOut(amountOut: bigint, toleranceBps: number): bigint {
  if (toleranceBps <= 0) return amountOut
  return (amountOut * BigInt(10_000 - toleranceBps)) / 10_000n
}

/* ── the liquidity-provider arithmetic ─────────────────────────────────────────────────────────
 *
 * `UniswapV2Pair.mint` and `.burn`, ported for the same reason the swap arithmetic is: the reader
 * has to be shown what a deposit is worth BEFORE they sign it, and there is no view function on the
 * pair that will say. `mint` computes the LP amount from the balances it finds when it is called,
 * which means the only way to ask the chain is to send the transaction.
 *
 * So this is an ESTIMATE, and every caller labels it as one. The two things that can move it
 * between the quote and the block are stated on the page rather than hidden here: somebody else's
 * trade changes the ratio (which is what `amountAMin`/`amountBMin` are for), and a protocol fee
 * being switched on mints extra LP to `feeTo` in the same call, diluting this answer slightly.
 * `readFactoryFacts` reads whether that switch is on, and the add-liquidity page prints it.
 */

/**
 * The LP tokens the pair burns to `address(0)` on the very first deposit. 10³, from V2.
 *
 * IT IS NOT A FEE AND IT IS NOT RECOVERABLE. The first depositor receives `sqrt(k) − 1000` rather
 * than `sqrt(k)`, and those thousand units stay minted to the zero address forever, so a pool can
 * never be emptied to a total supply of zero and the `sqrt` branch below can never be re-entered
 * against reserves somebody left behind. On an 18-decimal pair it is a millionth of a millionth of
 * a token; on a 6-decimal one it is a thousandth of a unit, which is worth saying out loud.
 */
export const MINIMUM_LIQUIDITY = 1_000n

/**
 * Integer square root, truncating — Babylonian, exactly as `UniswapV2Pair` does it.
 *
 * Not `Math.sqrt(Number(x))`. `sqrt(a·b)` on a first deposit is taken over a product of two
 * 18-decimal amounts, which routinely exceeds 2⁵³ by twenty orders of magnitude; a float would
 * answer with the right exponent and the wrong number, and the page would print an LP balance that
 * disagrees with the one the pair mints. Truncating is what the contract does, so this truncates.
 */
export function sqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError('sqrt of a negative')
  if (value < 2n) return value
  let x = value
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + value / x) / 2n
  }
  return x
}

/**
 * What the pair would mint for a deposit of `amount0` and `amount1`, or null.
 *
 * TWO BRANCHES, AND WHICH ONE APPLIES IS THE MOST IMPORTANT THING ON THE PAGE. With a total supply
 * of zero this is a first deposit: the amounts are not checked against anything, because there is
 * nothing to check them against — whatever ratio is deposited BECOMES the price. Afterwards the
 * mint is the smaller of the two proportional claims, and the excess on the other side is a gift to
 * the pool, which is why the router computes an optimal counter-amount instead of taking both
 * numbers at face value.
 *
 * Null rather than zero where there is no answer: a non-positive amount, a supply that is positive
 * against a reserve of zero (a pair whose state cannot be read consistently), or a mint that rounds
 * to nothing — the pair itself reverts on that last one with `INSUFFICIENT_LIQUIDITY_MINTED`, and a
 * zero on screen would read as "this deposit is free" rather than as "this deposit fails".
 */
export function liquidityMinted(opts: {
  readonly amount0: bigint
  readonly amount1: bigint
  readonly reserve0: bigint
  readonly reserve1: bigint
  readonly totalSupply: bigint
}): bigint | null {
  const { amount0, amount1, reserve0, reserve1, totalSupply } = opts
  if (amount0 <= 0n || amount1 <= 0n || totalSupply < 0n) return null
  if (totalSupply === 0n) {
    const root = sqrt(amount0 * amount1)
    if (root <= MINIMUM_LIQUIDITY) return null
    return root - MINIMUM_LIQUIDITY
  }
  if (reserve0 <= 0n || reserve1 <= 0n) return null
  const from0 = (amount0 * totalSupply) / reserve0
  const from1 = (amount1 * totalSupply) / reserve1
  const minted = from0 < from1 ? from0 : from1
  return minted > 0n ? minted : null
}

/**
 * A holding as a share of the pool, in basis points. Null when there is nothing to be a share of.
 *
 * Basis points rather than a float, because `formatBps` already exists and because a share below a
 * hundredth of a percent renders there as "<0.01%" rather than as a zero. A liquidity provider
 * holding a dust position should be told it is dust, not told it is nothing.
 */
export function shareBps(liquidity: bigint, totalSupply: bigint): number | null {
  if (liquidity < 0n || totalSupply <= 0n) return null
  return Number((liquidity * 10_000n) / totalSupply)
}

/**
 * What a quantity of LP tokens is a claim on, at these reserves. `UniswapV2Pair.burn`, pro rata.
 *
 * The contract divides by the pair's token BALANCES rather than by its reserves, and the two differ
 * only when somebody has transferred tokens to the pair without syncing — which is a donation, and
 * which makes the real burn slightly larger than this. Erring low is the right direction: the
 * numbers this feeds are the ones a reader sets a minimum against, and a minimum computed from an
 * over-estimate is a withdrawal that reverts.
 */
export function underlyingOf(opts: {
  readonly liquidity: bigint
  readonly totalSupply: bigint
  readonly reserve0: bigint
  readonly reserve1: bigint
}): { readonly amount0: bigint; readonly amount1: bigint } | null {
  const { liquidity, totalSupply, reserve0, reserve1 } = opts
  if (liquidity <= 0n || totalSupply <= 0n || liquidity > totalSupply) return null
  return {
    amount0: (liquidity * reserve0) / totalSupply,
    amount1: (liquidity * reserve1) / totalSupply,
  }
}

/**
 * A percentage of a holding, as an exact integer amount.
 *
 * 100% is returned unchanged rather than computed, so that "all of it" is bit-for-bit the balance
 * the pair will let go of. `(balance * 100n) / 100n` happens to be exact, but the day somebody
 * changes the steps to include 33% the rounding would silently leave a wei behind, and a "remove
 * everything" that leaves a position on the screen is a bug report.
 */
export function portionOf(balance: bigint, percent: number): bigint {
  if (balance <= 0n || percent <= 0) return 0n
  if (percent >= 100) return balance
  return (balance * BigInt(Math.floor(percent))) / 100n
}

/**
 * The constant product, for display.
 *
 * `k` is the invariant the whole design rests on and it is the one number that says whether a swap
 * was honest: it must never fall. The seed round trip in phase E checked exactly this on every leg.
 */
export function constantProduct(reserve0: bigint, reserve1: bigint): bigint {
  return reserve0 * reserve1
}

/**
 * The curve, as points, for plotting.
 *
 * `x·y = k` sampled across a window of the input reserve. Returned in TOKEN UNITS as numbers rather
 * than as wei bigints, because this feeds an SVG and an SVG coordinate is a float — the conversion
 * has to happen somewhere and doing it here keeps `Number()` out of every consumer, where it would
 * eventually be applied to a balance rather than to a pixel.
 *
 * The window is `[reserveIn/8, reserveIn*4]` rather than `[0, ∞)`: the branch of a hyperbola near
 * either axis is visually a straight line along it, and a plot that spends 80% of its width on the
 * asymptotes says nothing about the region a real trade moves through.
 */
export function curvePoints(
  reserveIn: bigint,
  reserveOut: bigint,
  samples = 96,
): readonly { readonly x: number; readonly y: number }[] {
  if (reserveIn <= 0n || reserveOut <= 0n || samples < 2) return []
  const x0 = Number(reserveIn)
  const y0 = Number(reserveOut)
  const k = x0 * y0
  const lo = x0 / 8
  const hi = x0 * 4
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < samples; i += 1) {
    const x = lo + ((hi - lo) * i) / (samples - 1)
    out.push({ x, y: k / x })
  }
  return out
}
