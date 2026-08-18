/**
 * A chain, on the wire.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS THE ONLY PLACE IN THE SUITE THAT KNOWS WHAT `getReserves()` LOOKS LIKE AS BYTES.
 *
 * Every other frontend in this estate stubs an API: a route per resource, a JSON object per route,
 * and a test reads `GET /v1/pool` and writes down the shape micro-pool returns. This surface has no
 * API. Every read it makes is a POST to ONE address with a JSON-RPC envelope in the body, and the
 * answer is a hex string that only means something once `src/lib/abi.ts` has walked it word by word.
 * So the dispatcher below keys on `method` out of the BODY rather than on the path, and for
 * `eth_call` on the four-byte selector inside `params[0].data`.
 *
 * ── IT ENCODES BY THE SAME RULES `abi.ts` DECODES BY, AND NEITHER IS COPIED FROM THE OTHER ────
 *
 * Deliberately: an encoder written by pasting the decoder's arithmetic in reverse tests that the
 * arithmetic is self-consistent, which it is by construction. What is written here instead is the
 * ABI as the specification states it — head words, a byte offset for each dynamic argument, a length
 * word at that offset — so a decoder that walks it wrongly produces a wrong number rather than
 * agreeing with itself.
 *
 * The SELECTORS are not written down at all. They are derived from `SIG` through `selector()`, which
 * is the same derivation the app makes: this file cannot answer a call the app does not actually
 * send, and a signature typo in `abi.ts` makes every fixture here miss rather than quietly agreeing.
 *
 * ── A CALL THIS FIXTURE DOES NOT MODEL IS RECORDED, NOT GUESSED ──────────────────────────────
 *
 * `ethCall` returns null on every failure, so a stub that answered `0x` to something it had not
 * thought about would be indistinguishable from a contract that is not there — and the test would go
 * green against a page rendering "could not read the pool". Every unmodelled `(address, function)`
 * lands in `unmodelled`, which a scenario asserts is empty. That is the "no stub for this route"
 * error of `test/dom.ts`, moved inside the envelope where this surface's routing actually happens.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { selector, SIG } from '../src/lib/abi.ts'
import {
  deploymentFor,
  getAmountOut,
  pairFor,
  sortTokens,
  type Deployment,
} from '../src/lib/dex.ts'
import { receiptsFor } from '../src/lib/receipts.ts'
import type { Reply, Routes, Wire } from './dom.ts'

/* ── the deployment these fixtures are a chain for ─────────────────────────────────────────── */

/** Hearth. The one chain `src/lib/dex.ts` holds contracts for. */
export const HEARTH_CHAIN_ID = 7411

/**
 * The deployment, read out of the app's own table rather than restated here.
 *
 * A `throw` at module scope rather than a `?? fallback`: if `dex.ts` ever stops holding a row for
 * 7411 the honest outcome is that this fixture cannot be built, and every scenario below fails
 * naming the reason. A fallback would let them keep passing against a chain the app does not know.
 */
const found = deploymentFor(HEARTH_CHAIN_ID)
if (found === null) {
  throw new Error(
    `test/fixtures.ts is built around chain ${HEARTH_CHAIN_ID}, and src/lib/dex.ts no longer holds ` +
      `a deployment for it`,
  )
}
export const HEARTH: Deployment = found

/**
 * A chain the exchange is not on.
 *
 * Ethereum mainnet, and it used to be Hearth testnet — which was wrong from the day it was written,
 * because 7412 has run Forge Exchange since phase D. A fixture named "not on" has to name a chain
 * that is genuinely not in `DEPLOYMENTS`, and 1 is the chain nothing in this estate will ever
 * deploy to. The assertion below keeps it that way rather than trusting this comment.
 */
export const OTHER_CHAIN_ID = 1
if (deploymentFor(OTHER_CHAIN_ID) !== null) {
  throw new Error(
    `test/fixtures.ts uses chain ${OTHER_CHAIN_ID} as "a chain the exchange is not on", and ` +
      `src/lib/dex.ts now holds a deployment for it`,
  )
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/* ── words ─────────────────────────────────────────────────────────────────────────────────── */

const bare = (hex: string): string => (hex.startsWith('0x') ? hex.slice(2) : hex).toLowerCase()

/** A `uint256`, as one 32-byte word of hex with no `0x`. */
const uintWord = (value: bigint): string => value.toString(16).padStart(64, '0')

/** An `address`, left-padded into one word. The high twelve bytes are zero, as the spec requires. */
const addressWord = (address: string): string => bare(address).padStart(64, '0')

/** A `bytes32`, as itself. */
const bytesWord = (value: string): string => bare(value).padStart(64, '0')

/** Words joined into a return value. */
const returns = (...words: readonly string[]): string => `0x${words.join('')}`

/**
 * A `string` return: the offset, the byte length, then the bytes, right-padded to a whole word.
 *
 * The offset is 32 because a `string` is the only return value on this surface — with a single
 * dynamic argument the head is one word and the tail begins immediately after it. Writing `0x20`
 * for a two-value return would be the classic hand-encoding mistake, and there is no such return
 * here to make it in.
 */
function stringReturn(text: string): string {
  const encoded = [...new TextEncoder().encode(text)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const chunks: string[] = []
  for (let i = 0; i < encoded.length; i += 64) chunks.push(encoded.slice(i, i + 64).padEnd(64, '0'))
  if (chunks.length === 0) chunks.push('0'.repeat(64))
  return returns(uintWord(32n), uintWord(BigInt(encoded.length / 2)), ...chunks)
}

/** A `uint256[]` return, in the same head-and-tail form. */
function uintArrayReturn(values: readonly bigint[]): string {
  return returns(uintWord(32n), uintWord(BigInt(values.length)), ...values.map(uintWord))
}

/** One string's own encoding: its byte length, and its bytes right-padded to whole words. */
function stringBody(text: string): { readonly length: bigint; readonly chunks: string[] } {
  const encoded = [...new TextEncoder().encode(text)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const chunks: string[] = []
  for (let i = 0; i < encoded.length; i += 64) chunks.push(encoded.slice(i, i + 64).padEnd(64, '0'))
  if (chunks.length === 0) chunks.push('0'.repeat(64))
  return { length: BigInt(encoded.length / 2), chunks }
}

/**
 * A `string[]` return — TWO levels of offset, which is the whole reason it is written out here.
 *
 * The head holds one offset to the array. At that offset sits the length, then one offset PER
 * ELEMENT, and each of those is measured from the first of the element-offset words rather than
 * from the start of the return data. A decoder that resolves an element offset absolutely reads
 * somebody else's bytes and produces a plausible-looking address, which is exactly the class of
 * failure this surface must not have on a page about where the money is. `reserveAddresses()` is
 * the only call on this surface with this shape, so this is the only fixture that can catch it.
 */
function stringArrayReturn(items: readonly string[]): string {
  const bodies = items.map(stringBody)
  const offsets: string[] = []
  const tail: string[] = []
  let cursor = items.length * 32
  for (const body of bodies) {
    offsets.push(uintWord(BigInt(cursor)))
    tail.push(uintWord(body.length), ...body.chunks)
    cursor += 32 + body.chunks.length * 32
  }
  return returns(uintWord(32n), uintWord(BigInt(items.length)), ...offsets, ...tail)
}

/**
 * `redemption(uint256)` — `(address, uint256, string, uint64, bytes32)`.
 *
 * A FIVE-WORD HEAD FOLLOWED BY THE STRING'S TAIL, which means the settled transaction id is head
 * word 4 and the LAST word of this data is text. `deploy/scripts/hearth-receipt-deploy.js` read it
 * from the end once and reported a settlement failure against a settlement that was correct on
 * chain. This encoder is written from the ABI spec rather than from the decoder, so a decoder that
 * goes back to reading the last word gets the ASCII rather than agreeing with itself.
 */
function redemptionReturn(row: FixtureRedemption): string {
  const body = stringBody(row.payoutAddress)
  return returns(
    addressWord(row.holder),
    uintWord(row.amount),
    uintWord(BigInt(5 * 32)),
    uintWord(BigInt(row.requestedAt)),
    bytesWord(row.settledTxid ?? '0x0'),
    uintWord(body.length),
    ...body.chunks,
  )
}

/* ── reading the calldata back ─────────────────────────────────────────────────────────────── */

const argWord = (data: string, index: number): string =>
  bare(data).slice(8 + index * 64, 8 + (index + 1) * 64)

const argUint = (data: string, index: number): bigint => BigInt(`0x${argWord(data, index)}`)

const argAddress = (data: string, index: number): string => `0x${argWord(data, index).slice(24)}`

/**
 * The `address[]` whose head word is at `index`.
 *
 * The head is a BYTE offset from the start of the argument block, so it is divided by 32 to become
 * a word index. Reading it as a word index directly is the mistake `abi.ts` warns about from the
 * encoding side, and doing it here would make this fixture agree with an encoder that made it.
 */
function argAddressArray(data: string, index: number): string[] {
  const at = Number(argUint(data, index)) / 32
  const length = Number(argUint(data, at))
  const out: string[] = []
  for (let i = 0; i < length; i += 1) out.push(argAddress(data, at + 1 + i))
  return out
}

/** Every signature in `SIG`, by its derived selector, so a miss can be named rather than numbered. */
const FUNCTION_NAMES: ReadonlyMap<string, string> = new Map(
  Object.entries(SIG).map(([name, signature]) => [selector(signature), name]),
)

const is = (data: string, signature: string): boolean =>
  bare(data).startsWith(bare(selector(signature)))

/* ── the model ─────────────────────────────────────────────────────────────────────────────── */

export interface FixtureToken {
  readonly address: string
  /** `null` makes `symbol()` answer nothing readable — a real ERC-20 shape, and the one that
   *  makes the pages render an address instead of an empty chip. */
  readonly symbol: string | null
  /** `null` makes `decimals()` answer nothing, which is what `decimalsAssumed` exists for. */
  readonly decimals: number | null
}

export interface FixturePair {
  readonly address: string
  readonly token0: FixtureToken
  readonly token1: FixtureToken
  readonly reserve0: bigint
  readonly reserve1: bigint
  readonly totalSupply: bigint | null
}

/** One redemption in a receipt's book. `settledTxid: null` is burnt and not yet paid. */
export interface FixtureRedemption {
  readonly holder: string
  readonly amount: bigint
  readonly payoutAddress: string
  readonly requestedAt: number
  readonly settledTxid: string | null
}

/**
 * A `ForgeReceipt`, as the wire sees it.
 *
 * `fresh` is NOT a field. It is derived below from `attestedAt`, `maxAge` and the fixture's chain
 * clock, exactly as `attestationIsFresh()` derives it on chain — a scenario that could set it
 * independently of the timestamps could describe a chain that cannot exist, and the page reads the
 * contract's answer precisely so that it is not doing this arithmetic itself.
 */
export interface FixtureReceipt {
  readonly address: string
  readonly name: string
  readonly symbol: string
  readonly decimals: number
  readonly underlying: string
  readonly statement: string
  readonly issuer: string
  readonly supply: bigint
  readonly reserve: bigint
  /** The height on the UNDERLYING chain the reserve was read at. Zero means never attested. */
  readonly height: bigint
  /** This chain's timestamp when it was recorded. Zero means never attested. */
  readonly attestedAt: bigint
  readonly maxAge: bigint
  readonly reference: string
  readonly reserveAddresses: readonly string[]
  readonly redemptions: readonly FixtureRedemption[]
}

/* ── the tokens these scenarios trade ──────────────────────────────────────────────────────── */

/** The wrapped native coin, at the deployment's own address so the router's boundary is real. */
export const WEMBER: FixtureToken = {
  address: HEARTH.wrapped,
  symbol: 'WEMBER',
  decimals: 18,
}

/** The token Forge Create deployed as a test issue. Eighteen decimals, like most of them. */
export const NEFELI: FixtureToken = {
  address: '0x4b1d0a7f39c8e25d6b04fa17c3e9825d0f6a1b4c',
  symbol: 'NEFELI',
  decimals: 18,
}

/** Six decimals, because eighteen everywhere is how a decimals bug survives a whole test suite. */
export const SILT: FixtureToken = {
  address: '0x9c2e7f10a4b83d6e5f0192c7ab34de56f7890a1b',
  symbol: 'SILT',
  decimals: 6,
}

/** A token that answers neither `symbol()` nor `decimals()`. They exist, and the pages say so. */
export const QUIET: FixtureToken = {
  address: '0x7a3f8c21b09de456f1a27cd80b34e9f61c25a708',
  symbol: null,
  decimals: null,
}

/** An address with a wallet behind it, for the balance and allowance reads. */
export const HOLDER = '0x6f0b3a95d2c41e78f503b9a6c2d17e480f3a5b62'

/** Whoever may turn the protocol fee on. A real address, because printing one is the point. */
export const FEE_SETTER = '0x2d84c1f905e63b7a08fd41c29e7b6350a1d8f4e2'

/**
 * An address that is NOT the CREATE2 address for the tokens the contract there reports.
 *
 * The pool page derives a pair's address in the reader's browser and prints whether it matches. A
 * scenario for the mismatch needs a contract at an address the derivation does not produce, and
 * "some other address" is the whole of what that means.
 */
export const IMPOSTOR_PAIR = '0x3e91c05a7bd248f60193ac5e8f2b47d09c6a1e83'

/* ── the receipts ──────────────────────────────────────────────────────────────────────────── */

/** The chain `src/lib/receipts.ts` holds receipts for. Not Hearth mainnet, deliberately. */
export const RECEIPT_CHAIN_ID = 7412

/**
 * The two rows, read out of the app's own table for the reason `HEARTH` is.
 *
 * A fixture that wrote the addresses down would keep passing after the table moved, and the page
 * would be reading contracts nothing here models while the suite stayed green — the `unmodelled`
 * list would catch that, but only in the scenarios that assert on it. Reading the table makes it
 * impossible instead of merely detectable.
 */
const issuedRow = receiptsFor(RECEIPT_CHAIN_ID).find((row) => row.kind === 'issued')
const drillRow = receiptsFor(RECEIPT_CHAIN_ID).find((row) => row.kind === 'drill')
if (issuedRow === undefined || drillRow === undefined) {
  throw new Error(
    `test/fixtures.ts models an issued receipt and a drill on chain ${RECEIPT_CHAIN_ID}, and ` +
      `src/lib/receipts.ts no longer holds both`,
  )
}

/**
 * The chain's clock, for judging an attestation's age.
 *
 * A FIXED NUMBER. Freshness in a scenario is decided by the scenario, not by when the suite happens
 * to run: a fixture that read the wall clock would make `stale` untestable and `fresh` pass forever,
 * which is the same test either way.
 */
export const CHAIN_NOW = 1_786_838_400

/** Whoever may attest, issue and settle: the 2-of-3 multisig, in the shape of an address. */
export const ISSUER = '0x51faced76d70981e863be2987ccc811b0712e4f8'

/**
 * fLTC — attested, fully covered, and holding a reserve of zero because it has issued nothing.
 *
 * THE RESERVE ADDRESSES HERE ARE INVENTED, and that is not laziness. The real ones are published by
 * the contract and read off it at runtime, which is the entire argument of `src/lib/receipts.ts`;
 * writing them into a test would be the second copy that module exists to avoid, and it would go
 * stale silently the first time custody rotates a key.
 */
export const FLTC: FixtureReceipt = {
  address: issuedRow.address,
  name: 'Forge Receipt: Litecoin',
  symbol: issuedRow.symbol,
  decimals: 8,
  underlying: issuedRow.underlying,
  statement:
    'CloudsForge holds the Litecoin backing this token. This is a promise by CloudsForge, not a ' +
    'trustless peg.',
  issuer: ISSUER,
  supply: 0n,
  reserve: 0n,
  height: 3_161_026n,
  attestedAt: BigInt(CHAIN_NOW - 3_600),
  maxAge: 86_400n,
  reference: '0x9173116ba259641a250352ad99dfcdf3a49a996e9cbc1cf3976c313ad1a785eb',
  reserveAddresses: ['ltc1qfixtureaddressone', 'ltc1qfixtureaddresstwo'],
  redemptions: [],
}

/** The drill: attested, issued, burnt by a holder, paid for real, and settled with the txid. */
export const DEMBER: FixtureReceipt = {
  address: drillRow.address,
  name: 'Drill Receipt: EMBER',
  symbol: drillRow.symbol,
  decimals: 18,
  underlying: drillRow.underlying,
  statement: 'A test instrument on a test chain. Nobody should hold one.',
  issuer: ISSUER,
  supply: 0n,
  reserve: 1_000n,
  height: 19_380n,
  attestedAt: BigInt(CHAIN_NOW - 7_200),
  maxAge: 86_400n,
  reference: '0x00000000000000000000000000000000000000000000000000000000646d3131',
  // An address on THIS chain, because the drill's underlying is this chain's own coin. That is what
  // makes its `checkWith` null in the table: the check is a balance read on the estate's own
  // explorer, not a scan of another chain's unspent outputs, and the page has to say which.
  reserveAddresses: [ISSUER],
  redemptions: [
    {
      holder: HOLDER,
      amount: 1_000n,
      payoutAddress: HOLDER,
      requestedAt: CHAIN_NOW - 6_000,
      settledTxid: '0x4d1c0f8a2be7534619ad0c53f8b27e410956dfa3c8e1b70425d9f6031a8c74be',
    },
  ],
}

/* ── building a market ─────────────────────────────────────────────────────────────────────── */

/** Integer square root, for the LP supply V2 mints on a pool's first deposit. */
function isqrt(value: bigint): bigint {
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
 * A pool holding two tokens, in the order the PAIR would store them rather than the order written
 * here.
 *
 * `sortTokens` decides which is `token0`, exactly as the factory does at creation, and the reserves
 * follow their tokens. Writing them the other way round would produce a fixture whose price is the
 * reciprocal of the one it means — which is the failure `dex.ts` calls "a reader selling at the
 * reciprocal of the rate they read", and a fixture that hard-coded the ordering could never catch
 * the app making it.
 */
export function market(
  a: FixtureToken,
  amountA: bigint,
  b: FixtureToken,
  amountB: bigint,
  options: { readonly address?: string | undefined; readonly totalSupply?: bigint | null } = {},
): FixturePair {
  const [first] = sortTokens(a.address, b.address)
  const aIsFirst = first === a.address.toLowerCase()
  const reserve0 = aIsFirst ? amountA : amountB
  const reserve1 = aIsFirst ? amountB : amountA
  return {
    address: (options.address ?? pairFor(HEARTH, a.address, b.address)).toLowerCase(),
    token0: aIsFirst ? a : b,
    token1: aIsFirst ? b : a,
    reserve0,
    reserve1,
    totalSupply:
      options.totalSupply === undefined ? isqrt(reserve0 * reserve1) : options.totalSupply,
  }
}

/** The estate's one live market: EMBER against the token Forge Create issued to test itself. */
export const EMBER_NEFELI = market(WEMBER, 25_000n * 10n ** 18n, NEFELI, 4_950_000n * 10n ** 18n)

/** A second market, on a six-decimal token, so nothing here can assume eighteen. */
export const EMBER_SILT = market(WEMBER, 800n * 10n ** 18n, SILT, 96_000n * 10n ** 6n)

/* ── the chain ─────────────────────────────────────────────────────────────────────────────── */

export interface ChainOptions {
  /** What `eth_chainId` answers. Anything but `HEARTH_CHAIN_ID` renders "not deployed here". */
  readonly chainId?: number
  /** What `eth_blockNumber` answers. It is on screen in the header, so scenarios name it. */
  readonly head?: number
  readonly pairs?: readonly FixturePair[]
  /** The factory's own `pairCodeHash`. Defaults to the constant the bundle derives addresses from. */
  readonly pairCodeHash?: string | null
  readonly feeTo?: string | null
  readonly feeToSetter?: string | null
  /** What the router says its factory is. Defaults to the deployment's. */
  readonly routerFactory?: string | null
  /** What the router says its wrapped coin is. */
  readonly routerWrapped?: string | null
  /** `balanceOf` answers, keyed `token/owner`, both lower-cased. */
  readonly balances?: Readonly<Record<string, bigint>>
  /** `allowance` answers for the router as spender, keyed `token/owner`. */
  readonly allowances?: Readonly<Record<string, bigint>>
  /** `eth_getBalance` answers, keyed by owner. */
  readonly native?: Readonly<Record<string, bigint>>
  /**
   * The `ForgeReceipt`s standing at their table addresses. Empty by default.
   *
   * Empty is the honest default: 7411 carries no receipt, and a fixture that put one everywhere
   * would make the absence — the state the receipts page spends most of its screen on — the harder
   * one to write a scenario for.
   */
  readonly receipts?: readonly FixtureReceipt[]
  /**
   * The chain's own timestamp, which is what decides whether an attestation is fresh.
   *
   * `attestationIsFresh()` is `at != 0 && block.timestamp <= at + maxAttestationAge`, evaluated by
   * the NODE. The page reads that boolean rather than computing it, so a scenario makes a receipt
   * stale by moving this forward — not by setting a flag, which could describe a chain that cannot
   * exist.
   */
  readonly now?: number
  /** JSON-RPC methods the node refuses, for the read-did-not-come-back scenarios. */
  readonly refuses?: readonly string[]
  /**
   * The transactions that have receipts, keyed by lower-cased hash.
   *
   * ABSENCE IS PENDING, NOT MISSING. A hash this map does not name answers `null`, which is what a
   * node says for a transaction it has not mined yet — so a scenario writes a pending transaction
   * by not writing it here, and `unmodelled` stays empty either way. `reverted: true` is the third
   * state: mined, gas spent, nothing moved.
   */
  readonly mined?: Readonly<
    Record<string, { readonly reverted?: boolean; readonly blockNumber?: number }>
  >
}

export interface ChainFixture {
  /** Hand this straight to `mount({ routes })`. */
  readonly routes: Routes
  readonly deployment: Deployment
  readonly pairs: readonly FixturePair[]
  /**
   * Every `(address, function)` asked for that this fixture does not model, in order.
   *
   * A scenario asserts this is empty. It is the one thing standing between a green test and a page
   * that rendered "the pool did not answer" for every panel, because `ethCall` cannot tell a stub
   * that shrugged from a contract that is not there.
   */
  readonly unmodelled: string[]
}

/** The key under which a balance or an allowance is looked up. */
export const holding = (token: string, owner: string): string =>
  `${token.toLowerCase()}/${owner.toLowerCase()}`

/**
 * A chain, as a `test/dom.ts` route table.
 *
 * ONE route, `POST /`, because that is the whole of this surface's network surface. `rpcUrl()`
 * composes `https://rpc.<apex>` with no path, so every request this bundle makes arrives at `/`
 * with the method in the body — which is why the dispatch below is on `json.method` and not on a
 * URL. A scenario that wants a second endpoint (the Lantern ingest, say) adds a longer key; keys
 * are matched longest-prefix-first by the harness, so a more specific path wins.
 */
export function chain(options: ChainOptions = {}): ChainFixture {
  const pairs = options.pairs ?? [EMBER_NEFELI]
  const chainId = options.chainId ?? HEARTH_CHAIN_ID
  const head = options.head ?? 41_207
  const refuses = new Set(options.refuses ?? [])
  const balances = options.balances ?? {}
  const allowances = options.allowances ?? {}
  const native = options.native ?? {}
  const receipts = options.receipts ?? []
  const now = options.now ?? CHAIN_NOW
  const unmodelled: string[] = []

  /** Every token any pool here holds, by address. */
  const tokens = new Map<string, FixtureToken>()
  for (const pair of pairs) {
    tokens.set(pair.token0.address.toLowerCase(), pair.token0)
    tokens.set(pair.token1.address.toLowerCase(), pair.token1)
  }

  const pairAt = (address: string): FixturePair | undefined =>
    pairs.find((p) => p.address === address.toLowerCase())

  const receiptAt = (address: string): FixtureReceipt | undefined =>
    receipts.find((r) => r.address.toLowerCase() === address.toLowerCase())

  /** The contract's own rule, transcribed: never fresh when it has never been attested. */
  const isFresh = (receipt: FixtureReceipt): boolean =>
    receipt.attestedAt !== 0n && BigInt(now) <= receipt.attestedAt + receipt.maxAge

  const pairOf = (a: string, b: string): FixturePair | undefined => {
    const [token0, token1] = sortTokens(a, b)
    return pairs.find(
      (p) => p.token0.address.toLowerCase() === token0 && p.token1.address.toLowerCase() === token1,
    )
  }

  /** `null` means "this fixture has no answer" and is recorded; `'0x'` would be a lie. */
  function ethCall(to: string, data: string): string | null {
    const at = to.toLowerCase()

    if (at === HEARTH.factory.toLowerCase()) {
      if (is(data, SIG.allPairsLength)) return returns(uintWord(BigInt(pairs.length)))
      if (is(data, SIG.allPairs)) {
        const index = Number(argUint(data, 0))
        const pair = pairs[index]
        return pair === undefined ? null : returns(addressWord(pair.address))
      }
      if (is(data, SIG.getPair)) {
        const pair = pairOf(argAddress(data, 0), argAddress(data, 1))
        // The zero address is the factory's real answer for a pair it has never made, and it is an
        // ANSWER rather than a miss — `readPairAddress` turns it into null on the app's side.
        return returns(addressWord(pair?.address ?? ZERO_ADDRESS))
      }
      if (is(data, SIG.pairCodeHash)) {
        const hash = options.pairCodeHash === undefined ? HEARTH.initCodeHash : options.pairCodeHash
        return hash === null ? null : returns(bytesWord(hash))
      }
      if (is(data, SIG.feeTo)) {
        const feeTo = options.feeTo === undefined ? ZERO_ADDRESS : options.feeTo
        return feeTo === null ? null : returns(addressWord(feeTo))
      }
      if (is(data, SIG.feeToSetter)) {
        const setter = options.feeToSetter === undefined ? FEE_SETTER : options.feeToSetter
        return setter === null ? null : returns(addressWord(setter))
      }
    }

    if (at === HEARTH.router.toLowerCase()) {
      if (is(data, SIG.factory)) {
        const factory = options.routerFactory === undefined ? HEARTH.factory : options.routerFactory
        return factory === null ? null : returns(addressWord(factory))
      }
      if (is(data, SIG.WETH)) {
        const wrapped = options.routerWrapped === undefined ? HEARTH.wrapped : options.routerWrapped
        return wrapped === null ? null : returns(addressWord(wrapped))
      }
      if (is(data, SIG.getAmountsOut)) {
        const amountIn = argUint(data, 0)
        const path = argAddressArray(data, 1)
        const amounts: bigint[] = [amountIn]
        for (let hop = 0; hop + 1 < path.length; hop += 1) {
          const from = path[hop] as string
          const to2 = path[hop + 1] as string
          const pair = pairOf(from, to2)
          if (pair === undefined) return null
          const forward = pair.token0.address.toLowerCase() === from.toLowerCase()
          const out = getAmountOut(
            amounts[amounts.length - 1] as bigint,
            forward ? pair.reserve0 : pair.reserve1,
            forward ? pair.reserve1 : pair.reserve0,
          )
          if (out === null) return null
          amounts.push(out)
        }
        return uintArrayReturn(amounts)
      }
    }

    const pair = pairAt(at)
    if (pair !== undefined) {
      // `getReserves()` is `(uint112, uint112, uint32)` — THREE words. The third is
      // `blockTimestampLast`, and a fixture that returned two would let a decoder reading slot 2 as
      // part of a reserve pass.
      if (is(data, SIG.getReserves)) {
        return returns(
          uintWord(pair.reserve0),
          uintWord(pair.reserve1),
          uintWord(BigInt(head)),
        )
      }
      if (is(data, SIG.token0)) return returns(addressWord(pair.token0.address))
      if (is(data, SIG.token1)) return returns(addressWord(pair.token1.address))
      if (is(data, SIG.totalSupply)) {
        return pair.totalSupply === null ? null : returns(uintWord(pair.totalSupply))
      }
      // ── A PAIR IS ITSELF AN ERC-20, AND THAT IS THE WHOLE OF WHAT A "POSITION" IS ────────────
      //
      // There is no positions table on a constant-product AMM: a holding is a balance of the pair
      // contract's own token and nothing else. So `balanceOf` and `allowance` are answered here
      // from the same two maps the token branch uses, keyed by the PAIR's address — which is also
      // what the withdraw form approves, and the one flow on this surface where the token being
      // approved is the pool itself.
      //
      // Answered on the pair branch rather than left to fall through, because `tokens` is built
      // from the tokens pools HOLD and a pair is not one of them; without this every LP read would
      // land in `unmodelled` and the positions page would render "the factory did not answer".
      if (is(data, SIG.balanceOf)) {
        return returns(uintWord(balances[holding(at, argAddress(data, 0))] ?? 0n))
      }
      if (is(data, SIG.allowance)) {
        return returns(uintWord(allowances[holding(at, argAddress(data, 0))] ?? 0n))
      }
    }

    // BEFORE the token branch, and it falls through to it. A receipt IS an ERC-20, so a scenario
    // could put one in a pool; where both know an answer the receipt's own model is the right one,
    // and `balanceOf`/`allowance` — which this branch does not carry — reach the token branch below.
    const receipt = receiptAt(at)
    if (receipt !== undefined) {
      if (is(data, SIG.name)) return stringReturn(receipt.name)
      if (is(data, SIG.symbol)) return stringReturn(receipt.symbol)
      if (is(data, SIG.decimals)) return returns(uintWord(BigInt(receipt.decimals)))
      if (is(data, SIG.underlying)) return stringReturn(receipt.underlying)
      if (is(data, SIG.issuerStatement)) return stringReturn(receipt.statement)
      if (is(data, SIG.issuer)) return returns(addressWord(receipt.issuer))
      // Five STATIC words: (supply, reserve, height, at, fresh). A fixture that returned four would
      // let a decoder reading `fresh` out of the wrong slot pass, and `fresh` is the one field on
      // this page that says whether the rest of it can be believed.
      if (is(data, SIG.coverage)) {
        return returns(
          uintWord(receipt.supply),
          uintWord(receipt.reserve),
          uintWord(receipt.height),
          uintWord(receipt.attestedAt),
          uintWord(isFresh(receipt) ? 1n : 0n),
        )
      }
      // The struct's generated getter: (reserve, height, at, ref). It overlaps `coverage` in three
      // of its four words on purpose — the page reads both, and reading the reference out of the
      // wrong one of them is the mistake this shape exists to expose.
      if (is(data, SIG.attestation)) {
        return returns(
          uintWord(receipt.reserve),
          uintWord(receipt.height),
          uintWord(receipt.attestedAt),
          bytesWord(receipt.reference),
        )
      }
      if (is(data, SIG.maxAttestationAge)) return returns(uintWord(receipt.maxAge))
      if (is(data, SIG.reserveAddresses)) return stringArrayReturn(receipt.reserveAddresses)
      if (is(data, SIG.redemptionCount)) {
        return returns(uintWord(BigInt(receipt.redemptions.length)))
      }
      if (is(data, SIG.redemption)) {
        // Out of range REVERTS on chain — the array access does — so null is the honest answer and
        // not a miss. Recording it as unmodelled would report a page reading past the end as a gap
        // in this fixture rather than as the bug it is.
        const row = receipt.redemptions[Number(argUint(data, 0))]
        return row === undefined ? null : redemptionReturn(row)
      }
      if (is(data, SIG.unsettledRedemptions)) {
        const owing = receipt.redemptions.filter((row) => row.settledTxid === null)
        return returns(
          uintWord(BigInt(owing.length)),
          uintWord(owing.reduce((sum, row) => sum + row.amount, 0n)),
        )
      }
    }

    const token = tokens.get(at)
    if (token !== undefined) {
      if (is(data, SIG.symbol)) return token.symbol === null ? null : stringReturn(token.symbol)
      if (is(data, SIG.decimals)) {
        return token.decimals === null ? null : returns(uintWord(BigInt(token.decimals)))
      }
      if (is(data, SIG.balanceOf)) {
        return returns(uintWord(balances[holding(at, argAddress(data, 0))] ?? 0n))
      }
      if (is(data, SIG.allowance)) {
        return returns(uintWord(allowances[holding(at, argAddress(data, 0))] ?? 0n))
      }
    }

    const name = FUNCTION_NAMES.get(bare(data).slice(0, 8).padStart(10, '0x')) ?? null
    unmodelled.push(`${at} ${name ?? `0x${bare(data).slice(0, 8)}`}`)
    return null
  }

  const routes: Routes = {
    'POST /': (wire: Wire): Reply => {
      const envelope = wire.json as
        | { id?: unknown; method?: unknown; params?: unknown[] }
        | undefined
      if (envelope === undefined || typeof envelope.method !== 'string') {
        unmodelled.push(`${wire.path} is not a JSON-RPC request`)
        return { status: 400, body: { error: 'not a JSON-RPC request' } }
      }
      const id = typeof envelope.id === 'number' ? envelope.id : 0
      const ok = (result: unknown): Reply => ({ body: { jsonrpc: '2.0', id, result } })
      // A JSON-RPC error envelope, which is what a node sends for a revert. `rpc.ts` turns it into
      // an `RpcError` carrying the node's own message, and `ethCall` turns that into null — the
      // path every "the pool did not answer" state on this surface travels.
      const revert = (message: string): Reply => ({
        body: { jsonrpc: '2.0', id, error: { code: -32000, message } },
      })

      if (refuses.has(envelope.method)) return revert('execution reverted')

      switch (envelope.method) {
        case 'eth_chainId':
          return ok(`0x${chainId.toString(16)}`)
        case 'eth_blockNumber':
          return ok(`0x${head.toString(16)}`)
        case 'eth_getBalance': {
          const owner = String((envelope.params ?? [])[0] ?? '')
          return ok(`0x${(native[owner.toLowerCase()] ?? 0n).toString(16)}`)
        }
        case 'eth_call': {
          const params = (envelope.params ?? [])[0] as { to?: string; data?: string } | undefined
          const to = params?.to ?? ''
          const data = params?.data ?? ''
          const result = ethCall(to, data)
          return result === null ? revert('execution reverted') : ok(result)
        }
        // ── A RECEIPT IS A THIRD ANSWER, AND `null` IS THE FIRST ONE ────────────────────────────
        //
        // A node answers `null` for a transaction it has not mined, for one it has never seen, and
        // for one it is about to mine. Those are the same bytes on the wire, so this fixture does
        // not distinguish them either: a hash `mined` does not name is pending, which is exactly
        // what `lib/tx.ts` polls through.
        //
        // `status` is `0x1` or `0x0`, and the second is the state this whole mechanism exists for —
        // MINED AND REVERTED, where the gas was spent, the hash is real and nothing moved.
        case 'eth_getTransactionReceipt': {
          const hash = String((envelope.params ?? [])[0] ?? '').toLowerCase()
          const mined = options.mined?.[hash]
          if (mined === undefined) return ok(null)
          return ok({
            transactionHash: hash,
            status: mined.reverted === true ? '0x0' : '0x1',
            blockNumber: `0x${(mined.blockNumber ?? head).toString(16)}`,
          })
        }
        default:
          unmodelled.push(`${envelope.method} is not a method this fixture answers`)
          return revert(`the method ${envelope.method} does not exist`)
      }
    },
  }

  return { routes, deployment: HEARTH, pairs, unmodelled }
}

/* ── reading what the page asked ───────────────────────────────────────────────────────────── */

/** Every JSON-RPC method the page called, in order. */
export function rpcMethods(wire: readonly Wire[]): string[] {
  return wire.map((call) => {
    const body = call.json as { method?: unknown } | undefined
    return typeof body?.method === 'string' ? body.method : '(not JSON-RPC)'
  })
}

/**
 * Every `eth_call`, as the contract it went to and the function it asked for.
 *
 * The function is NAMED rather than left as four bytes, so an assertion about what a page read is
 * legible — and so a scenario asserting a page made no calls at all reports what it did make.
 */
export function ethCalls(
  wire: readonly Wire[],
): { readonly to: string; readonly fn: string }[] {
  const out: { to: string; fn: string }[] = []
  for (const call of wire) {
    const body = call.json as { method?: unknown; params?: unknown[] } | undefined
    if (body?.method !== 'eth_call') continue
    const params = (body.params ?? [])[0] as { to?: string; data?: string } | undefined
    const data = bare(params?.data ?? '')
    out.push({
      to: (params?.to ?? '').toLowerCase(),
      fn: FUNCTION_NAMES.get(`0x${data.slice(0, 8)}`) ?? `0x${data.slice(0, 8)}`,
    })
  }
  return out
}

/* ── the wallet ────────────────────────────────────────────────────────────────────────────── */

/**
 * An injected EIP-1193 provider, and the transactions it was asked to sign.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS A STUB OF A BROWSER EXTENSION, NOT OF THE CHAIN, AND IT SIGNS NOTHING.
 *
 * `window.ethereum` is not a response the wire harness can answer — it is a global an extension put
 * there — so a scenario about what this surface would ask a wallet to sign cannot be written
 * without one. What it records is `sent`: the exact `{ from, to, data, value }` objects the pages
 * handed over, which is the only artefact that says where somebody's money was about to go.
 *
 * It is NOT a substitute for the extension end-to-end test. This proves the page builds the right
 * calldata and shows the right states around it; it cannot prove a real wallet accepts that
 * calldata, and `wallet-extension/test/e2e/` is where that is proved against a real node with no
 * request interception at all.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `rejects` makes the wallet decline, with EIP-1193's own 4001. Declining is a DECISION and not a
 * failure, and the pages must not render it as an error banner — which is a scenario, and needs
 * this switch to write it.
 */
/**
 * The hash this wallet answers a send with.
 *
 * Exported because it is the JOIN between the two halves of a signing scenario: the wallet returns
 * it, and `chain({ mined: { [WALLET_TX_HASH]: … } })` decides what became of it. A scenario that
 * wrote the string twice would go green with a typo in one of them, tracking a transaction the
 * chain was never asked about and reporting it as pending forever.
 */
export const WALLET_TX_HASH =
  '0x9f2c4a7e1d8b60533f0ae94c2b7d15806af3e29c4d0b7168a2e5fc93147b0d6a'

export interface WalletStub {
  /** Hand this to `mount({ windowExtras: { ethereum: wallet } })`. */
  readonly provider: {
    request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>
    on(event: string, handler: (...args: unknown[]) => void): void
    removeListener(event: string, handler: (...args: unknown[]) => void): void
  }
  /** Every `eth_sendTransaction` payload, in order. */
  readonly sent: { readonly from: string; readonly to: string; readonly data: string; readonly value: string }[]
  /** Every method asked of the wallet, in order — so a scenario can assert it did NOT prompt. */
  readonly asked: string[]
}

export function wallet(
  options: {
    /** The account already granted. `null` is a wallet installed but not connected to this origin. */
    readonly account?: string | null
    /** The chain the WALLET is on, which is a different fact from the chain being read. */
    readonly chainId?: number
    /** True when every signature request is declined with 4001. */
    readonly rejects?: boolean
    /** The hash returned for a send. One per scenario is enough; they all get the same one. */
    readonly hash?: string
  } = {},
): WalletStub {
  const account = options.account === undefined ? HOLDER : options.account
  const chainId = options.chainId ?? HEARTH_CHAIN_ID
  const hash = options.hash ?? WALLET_TX_HASH
  const sent: WalletStub['sent'] = []
  const asked: string[] = []

  const provider: WalletStub['provider'] = {
    async request({ method, params }) {
      asked.push(method)
      switch (method) {
        // `eth_accounts` is what the page asks on mount and it PROMPTS NOTHING; the difference
        // between the two is the reason a scenario asserts on `asked`.
        case 'eth_accounts':
          return account === null ? [] : [account]
        case 'eth_requestAccounts':
          if (options.rejects === true) throw Object.assign(new Error('User rejected'), { code: 4001 })
          return account === null ? [] : [account]
        case 'eth_chainId':
          return `0x${chainId.toString(16)}`
        case 'wallet_switchEthereumChain':
          if (options.rejects === true) throw Object.assign(new Error('User rejected'), { code: 4001 })
          return null
        case 'eth_sendTransaction': {
          if (options.rejects === true) throw Object.assign(new Error('User rejected'), { code: 4001 })
          const tx = (params ?? [])[0] as WalletStub['sent'][number]
          sent.push(tx)
          return hash
        }
        default:
          throw new Error(`the wallet stub was asked for ${method}, which it does not answer`)
      }
    },
    on: () => undefined,
    removeListener: () => undefined,
  }

  return { provider, sent, asked }
}
