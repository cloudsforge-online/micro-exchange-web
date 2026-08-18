/**
 * The reads: what this page asks the chain, assembled into the shapes the pages render.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY FUNCTION HERE IS A COMPOSITION OF `ethCall`s AND NOTHING ELSE.
 *
 * There is no cache, no store and no subscription. A quote is worth what it was worth at the block
 * it was read at, so this module re-reads on every render that needs a number and the pages show
 * the block height each answer came from. A cached reserve is a stale price wearing a live one's
 * clothes.
 *
 * ── NULL PROPAGATES, AND IS NEVER COLLAPSED ──────────────────────────────────────────────────
 *
 * `Reserves | null`, `TokenMeta | null`, `PairView | null`. A read that failed produces null all
 * the way up to the component, which renders "could not read the pool" — never a zero, never an
 * empty pool, never a price. The decoders in `abi.ts` were written to make that the easy path;
 * this module's job is not to undo it by defaulting somewhere convenient.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import {
  decodeAddressAt,
  decodeSymbol,
  decodeUintArrayAt,
  decodeUintAt,
  encodeCall,
  SIG,
  selector,
} from './abi.ts'
import { constantProduct, shareBps, sortTokens, underlyingOf, type Deployment } from './dex.ts'
import { ethCall } from './rpc.ts'

/** A token, as much as the chain will say about it. */
export interface TokenMeta {
  readonly address: string
  /** The symbol, or null when the token would not say. Rendered as the address in that case. */
  readonly symbol: string | null
  /** Decimals. **18 is assumed only when the call fails**, and the assumption is stated on screen. */
  readonly decimals: number
  /** True when `decimals()` did not answer and 18 is a guess rather than a reading. */
  readonly decimalsAssumed: boolean
  /** True when this address stands in for the chain's native coin at the router's boundary. */
  readonly native: boolean
}

/** A pair's state at one moment. */
export interface Reserves {
  readonly token0: string
  readonly token1: string
  readonly reserve0: bigint
  readonly reserve1: bigint
  /** `reserve0 * reserve1` — the invariant the pool must never let fall. */
  readonly k: bigint
  /** Total LP supply, for working out what a share of the pool is. */
  readonly totalSupply: bigint | null
}

/** Everything a page needs about one market. */
export interface PairView {
  readonly address: string
  readonly token0: TokenMeta
  readonly token1: TokenMeta
  readonly reserves: Reserves
}

/** `token()` metadata, read in one place so the fallbacks are the same everywhere. */
export async function readToken(
  address: string,
  deployment: Deployment,
): Promise<TokenMeta> {
  const [symbolData, decimalsData] = await Promise.all([
    ethCall(address, selector(SIG.symbol)),
    ethCall(address, selector(SIG.decimals)),
  ])
  const decimals = decodeUintAt(decimalsData, 0)
  const native = address.toLowerCase() === deployment.wrapped.toLowerCase()
  return {
    address: address.toLowerCase(),
    symbol: decodeSymbol(symbolData),
    // 18 is the right guess and it is still a guess. A token with 6 decimals read as 18 renders a
    // balance a trillion times too small, which is wrong in the direction a reader notices — so
    // the flag is carried and the page says "assumed" rather than printing a number that looks
    // measured. Silently defaulting is how a UI reports somebody's USDC balance as dust.
    decimals: decimals === null ? 18 : Number(decimals),
    decimalsAssumed: decimals === null,
    native,
  }
}

/** A pair's reserves, or null. */
export async function readReserves(pair: string): Promise<Reserves | null> {
  const [reservesData, token0Data, token1Data, supplyData] = await Promise.all([
    ethCall(pair, selector(SIG.getReserves)),
    ethCall(pair, selector(SIG.token0)),
    ethCall(pair, selector(SIG.token1)),
    ethCall(pair, selector(SIG.totalSupply)),
  ])
  // `getReserves()` returns `(uint112, uint112, uint32)` — three values in three words, so the
  // blockTimestampLast in slot 2 is read and discarded rather than mistaken for part of a reserve.
  const reserve0 = decodeUintAt(reservesData, 0)
  const reserve1 = decodeUintAt(reservesData, 1)
  const token0 = decodeAddressAt(token0Data, 0)
  const token1 = decodeAddressAt(token1Data, 0)
  if (reserve0 === null || reserve1 === null || token0 === null || token1 === null) return null
  return {
    token0,
    token1,
    reserve0,
    reserve1,
    k: constantProduct(reserve0, reserve1),
    totalSupply: decodeUintAt(supplyData, 0),
  }
}

/** The factory's own answer for a pair, or null when there is none. */
export async function readPairAddress(
  deployment: Deployment,
  tokenA: string,
  tokenB: string,
): Promise<string | null> {
  const [token0, token1] = sortTokens(tokenA, tokenB)
  const data = await ethCall(
    deployment.factory,
    encodeCall(SIG.getPair, [
      { type: 'address', value: token0 },
      { type: 'address', value: token1 },
    ]),
  )
  const address = decodeAddressAt(data, 0)
  // The factory answers the zero address for a pair it has never created, and that is an ANSWER
  // rather than a failure — but it is not an address, and returning it would send a swap to
  // `0x0`. Both cases become null here and the page distinguishes them by whether the read
  // succeeded at all.
  if (address === null || /^0x0{40}$/.test(address)) return null
  return address
}

/** How many pairs the factory has made, or null. */
export async function readPairCount(deployment: Deployment): Promise<number | null> {
  const data = await ethCall(deployment.factory, selector(SIG.allPairsLength))
  const count = decodeUintAt(data, 0)
  if (count === null || count > 100_000n) return null
  return Number(count)
}

/** The pair at an index in the factory's own list. */
export async function readPairAt(
  deployment: Deployment,
  index: number,
): Promise<string | null> {
  const data = await ethCall(
    deployment.factory,
    encodeCall(SIG.allPairs, [{ type: 'uint', value: BigInt(index) }]),
  )
  return decodeAddressAt(data, 0)
}

/**
 * Everything about one pair, in one call from a page's point of view.
 *
 * The two token reads run against whatever `token0`/`token1` the PAIR reports, not against what
 * the caller asked for. A pair is the authority on its own contents, and a page that labelled the
 * reserves from its own idea of the ordering would show the price upside down for exactly half of
 * all token addresses — which is the failure that looks like a working page.
 */
export async function readPair(
  deployment: Deployment,
  pair: string,
): Promise<PairView | null> {
  const reserves = await readReserves(pair)
  if (reserves === null) return null
  const [token0, token1] = await Promise.all([
    readToken(reserves.token0, deployment),
    readToken(reserves.token1, deployment),
  ])
  return { address: pair.toLowerCase(), token0, token1, reserves }
}

/**
 * Every pair on the chain, with its reserves.
 *
 * Bounded at 50 and the bound is REPORTED rather than silently applied — `pools.tsx` shows the
 * factory's own count beside the number of rows, so a reader can see that the list is a page of a
 * longer one. A truncation nobody mentions reads as "that is all there is", which is exactly the
 * wrong thing to tell somebody looking for a market.
 */
export const PAIR_PAGE_LIMIT = 50

/**
 * `null` — not an empty list — when the FACTORY ITSELF could not be read.
 *
 * A node that is unreachable and a factory that has never made a market are two completely different
 * things to tell somebody, and returning `{ pairs: [], total: null }` for the first makes them
 * indistinguishable downstream: `useResource` marks a read failed when it throws or answers null,
 * and an object with an empty array is neither. The page then renders "The factory has not created a
 * market yet" during an outage — which `lib/resource.ts` names in its own docstring as the exact
 * failure it exists to prevent ("reporting 'no pools here' for an unreachable node is how an outage
 * reads as a chain with no markets on it"), and which the swap form renders as "there is nothing to
 * trade against".
 *
 * A pair that individually failed to read is still dropped from the list rather than failing the
 * whole page: the count came back, so the factory answered, and one unreadable contract among fifty
 * is a fact about that contract.
 */
export async function readAllPairs(
  deployment: Deployment,
): Promise<{ readonly pairs: readonly PairView[]; readonly total: number } | null> {
  const total = await readPairCount(deployment)
  if (total === null) return null
  const indices = Array.from({ length: Math.min(total, PAIR_PAGE_LIMIT) }, (_, i) => i)
  const addresses = (await Promise.all(indices.map((i) => readPairAt(deployment, i)))).filter(
    (a): a is string => a !== null,
  )
  const pairs = (await Promise.all(addresses.map((a) => readPair(deployment, a)))).filter(
    (p): p is PairView => p !== null,
  )
  return { pairs, total }
}

/**
 * The router's own quote for a path — the number a swap will actually fill at.
 *
 * `swap.tsx` plots the curve with the local arithmetic in `dex.ts` and QUOTES with this. The two
 * agreeing is not assumed: the page shows this answer as the one that will be filled, and the
 * local one only ever draws a picture. If a fee parameter ever changes on chain, the picture goes
 * slightly wrong and the number stays right, which is the correct way round for that failure.
 */
export async function readAmountsOut(
  deployment: Deployment,
  amountIn: bigint,
  path: readonly string[],
): Promise<bigint[] | null> {
  if (amountIn <= 0n || path.length < 2) return null
  const data = await ethCall(
    deployment.router,
    encodeCall(SIG.getAmountsOut, [
      { type: 'uint', value: amountIn },
      { type: 'address[]', value: path },
    ]),
  )
  const amounts = decodeUintArrayAt(data, 0)
  // A path of n produces n amounts. Anything else is a decode that went somewhere it should not
  // have, and using the last element of it would be quoting from a misread word.
  if (amounts === null || amounts.length !== path.length) return null
  return amounts
}

/** An ERC-20 balance, or null. */
export async function readBalance(token: string, owner: string): Promise<bigint | null> {
  const data = await ethCall(
    token,
    encodeCall(SIG.balanceOf, [{ type: 'address', value: owner }]),
  )
  return decodeUintAt(data, 0)
}

/** What a spender is currently allowed to move. Null on a failed read; `0n` is a real answer. */
export async function readAllowance(
  token: string,
  owner: string,
  spender: string,
): Promise<bigint | null> {
  const data = await ethCall(
    token,
    encodeCall(SIG.allowance, [
      { type: 'address', value: owner },
      { type: 'address', value: spender },
    ]),
  )
  return decodeUintAt(data, 0)
}

/**
 * One holding of one pool's own ERC-20.
 *
 * A "position" in a constant-product AMM is not a record anywhere — there is no positions table, no
 * NFT and no registry. It is a BALANCE OF THE PAIR CONTRACT'S OWN TOKEN, and everything else about
 * it is arithmetic over that balance and the reserves at the block it was read. So this shape
 * carries the balance as the fact and the rest as derivations, and every derivation is nullable
 * because a pair whose supply would not read cannot be divided by.
 */
export interface Position {
  readonly pair: PairView
  /** The reader's balance of the pair's LP token, in its own 18 decimals. */
  readonly liquidity: bigint
  /** The share of the pool that balance is, in basis points. Null when the supply did not read. */
  readonly shareBps: number | null
  /** What the balance is a claim on right now, pro rata. Null for the same reason. */
  readonly amount0: bigint | null
  readonly amount1: bigint | null
}

/** One address's LP balance in one pair, with what it is worth at the reserves just read. */
export function positionIn(pair: PairView, liquidity: bigint): Position {
  const supply = pair.reserves.totalSupply
  if (supply === null || supply <= 0n) {
    return { pair, liquidity, shareBps: null, amount0: null, amount1: null }
  }
  const underlying = underlyingOf({
    liquidity,
    totalSupply: supply,
    reserve0: pair.reserves.reserve0,
    reserve1: pair.reserves.reserve1,
  })
  return {
    pair,
    liquidity,
    shareBps: shareBps(liquidity, supply),
    amount0: underlying?.amount0 ?? null,
    amount1: underlying?.amount1 ?? null,
  }
}

/**
 * Every pool this address holds liquidity in.
 *
 * ── IT SWEEPS THE FACTORY, BECAUSE THERE IS NOWHERE ELSE TO LOOK ─────────────────────────────
 *
 * No index maps a holder to their pools. The only honest way to answer "what do I have" is to ask
 * every pair for this address's balance, which is what this does — bounded by `PAIR_PAGE_LIMIT`,
 * and the bound is returned so the page can say the list is a page of a longer one rather than
 * implying a reader has nothing in the fifty-first pool. On a chain with one market that is one
 * extra call; the day it is not, the caption is already there.
 *
 * Null — not an empty list — when the FACTORY could not be read, for the reason `readAllPairs`
 * gives at length: "you have no positions" and "the node did not answer" are opposite things to
 * tell somebody, and the second one rendered as the first is how a reader concludes their deposit
 * vanished.
 *
 * Zero balances are dropped. A reader who has never supplied liquidity gets an empty list, which
 * the page renders as a sentence about what supplying liquidity is — not fifty rows of zero.
 */
export async function readPositions(
  deployment: Deployment,
  owner: string,
): Promise<{
  readonly positions: readonly Position[]
  readonly scanned: number
  readonly total: number
} | null> {
  const markets = await readAllPairs(deployment)
  if (markets === null) return null
  const balances = await Promise.all(
    markets.pairs.map((pair) => readBalance(pair.address, owner)),
  )
  const positions: Position[] = []
  markets.pairs.forEach((pair, index) => {
    // `Promise.all` preserves length, so the `?? null` is only there to satisfy
    // `noUncheckedIndexedAccess` — and it collapses into the branch below, which already treats
    // "did not read" as the same case.
    const liquidity = balances[index] ?? null
    // A balance that failed to read is dropped rather than shown as zero: one unreadable pair
    // among fifty is a fact about that pair, and a zero is a claim about this reader's money.
    if (liquidity === null || liquidity <= 0n) return
    positions.push(positionIn(pair, liquidity))
  })
  return { positions, scanned: markets.pairs.length, total: markets.total }
}

/**
 * The two facts about the factory that the plan calls traps, read live.
 *
 * `pairCodeHash` is trap 1: it must equal the `INIT_CODE_HASH` the router derives pair addresses
 * from, and `contracts.tsx` compares it with the constant in `dex.ts` in front of the reader.
 * `feeTo` is the fee switch — zero means no protocol fee is being taken, which is a claim this
 * surface makes in prose and must therefore be able to show.
 */
export async function readFactoryFacts(deployment: Deployment): Promise<{
  readonly pairCodeHash: string | null
  readonly feeTo: string | null
  readonly feeToSetter: string | null
}> {
  const [hashData, feeToData, setterData] = await Promise.all([
    ethCall(deployment.factory, selector(SIG.pairCodeHash)),
    ethCall(deployment.factory, selector(SIG.feeTo)),
    ethCall(deployment.factory, selector(SIG.feeToSetter)),
  ])
  const hash = decodeUintAt(hashData, 0)
  return {
    pairCodeHash: hash === null ? null : `0x${hash.toString(16).padStart(64, '0')}`,
    feeTo: decodeAddressAt(feeToData, 0),
    feeToSetter: decodeAddressAt(setterData, 0),
  }
}

/** What the router says its own factory and wrapped coin are. The check that the table is right. */
export async function readRouterFacts(deployment: Deployment): Promise<{
  readonly factory: string | null
  readonly wrapped: string | null
}> {
  const [factoryData, wethData] = await Promise.all([
    ethCall(deployment.router, selector(SIG.factory)),
    ethCall(deployment.router, selector(SIG.WETH)),
  ])
  return { factory: decodeAddressAt(factoryData, 0), wrapped: decodeAddressAt(wethData, 0) }
}
