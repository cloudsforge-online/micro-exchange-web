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

/** A chain the exchange is not on. Hearth testnet's id, which is a real number and not a made-up one. */
export const OTHER_CHAIN_ID = 7412

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
  /** JSON-RPC methods the node refuses, for the read-did-not-come-back scenarios. */
  readonly refuses?: readonly string[]
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
  const unmodelled: string[] = []

  /** Every token any pool here holds, by address. */
  const tokens = new Map<string, FixtureToken>()
  for (const pair of pairs) {
    tokens.set(pair.token0.address.toLowerCase(), pair.token0)
    tokens.set(pair.token1.address.toLowerCase(), pair.token1)
  }

  const pairAt = (address: string): FixturePair | undefined =>
    pairs.find((p) => p.address === address.toLowerCase())

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
