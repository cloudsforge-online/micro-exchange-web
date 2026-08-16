/**
 * The ABI codec: exactly the encodings this surface sends and the decodings it reads, and nothing
 * else.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * SELECTORS ARE DERIVED, NEVER MEMORISED.
 *
 * `selector('swapExactTokensForTokens(uint256,uint256,address[],address,uint256)')` hashes the
 * signature with the keccak in `keccak.ts` at call time. The alternative — pasting `0x38ed1739`
 * from a block explorer — produces a constant nobody in this repository can check, that is wrong in
 * a way no test can see, and that fails as a REVERT WITH NO REASON on a router holding somebody's
 * money. foresight-web's `lib/abi.ts` established this and micro-beacon's `browser/keccak.ts`
 * predates it; this file is the third copy of the argument and the second of the code.
 *
 * ── WHAT THIS FILE ADDS OVER foresight-web's ─────────────────────────────────────────────────
 *
 * `encodeAddressArray` and `decodeUintArrayAt`, for the one shape a market maker needs that a
 * prediction market does not: `getAmountsOut(uint256,address[]) → uint256[]` takes a PATH and
 * answers a fill per hop. Both are dynamic types, so both have to walk an offset word rather than
 * indexing a fixed slot — which is the part a hand-written codec gets wrong, and the part
 * `test/abi.test.ts` pins against vectors taken off the live chain.
 *
 * `decodeStringAt` for `symbol()`. It is deliberately NOT `decodeStringAt` alone: half the ERC-20s
 * in existence return `bytes32` from `symbol()` rather than `string`, so `decodeSymbol` tries the
 * dynamic form and falls back to trimming a fixed word. A token whose symbol cannot be read renders
 * as its address, which is always true, rather than as an empty string, which reads as a bug in
 * this page.
 *
 * ── EVERY DECODER RETURNS `null` RATHER THAN A ZERO ──────────────────────────────────────────
 *
 * Inherited verbatim from foresight-web, and it matters more here: a reserve of `0n` means an empty
 * pool and prices nothing, while a failed read means we do not know. Collapsing the two would let
 * this page quote a swap against reserves it never actually read — a confident zero where the truth
 * is "not known" is how a UI invents a price.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { keccak256Utf8 } from './keccak.ts'

/** The 4-byte selector for a canonical signature, as `0x` + 8 hex digits. */
export function selector(signature: string): string {
  return keccak256Utf8(signature).slice(0, 10)
}

/** A `uint256` as one 32-byte word of hex, no `0x`. Negative input is a programming error. */
export function encodeUint(value: bigint): string {
  if (value < 0n) throw new RangeError('uint256 cannot be negative')
  return value.toString(16).padStart(64, '0')
}

/** An address as one 32-byte word of hex, no `0x`. Left-padded, lower-cased, checksum ignored. */
export function encodeAddress(address: string): string {
  const bare = address.startsWith('0x') ? address.slice(2) : address
  return bare.toLowerCase().padStart(64, '0')
}

/**
 * An `address[]` as its ABI head-and-tail form, no `0x`.
 *
 * The caller supplies the OFFSET, because a dynamic argument's head is a byte offset from the start
 * of the argument block and only the caller knows how many words precede it. Getting that wrong is
 * the single most common hand-encoding mistake and it does not fail loudly — the node decodes some
 * other region of the calldata as a length, and `getAmountsOut` reverts or, worse, answers about a
 * path nobody asked for. `encodeCall` below computes it, so no caller here has to.
 */
export function encodeAddressArray(addresses: readonly string[]): string {
  return encodeUint(BigInt(addresses.length)) + addresses.map(encodeAddress).join('')
}

/**
 * A call: the selector, then every argument, with dynamic ones laid out head-then-tail.
 *
 * `Arg` is a discriminated union rather than `unknown`, so a caller cannot pass an address where a
 * uint belongs and get a silently valid-looking word. The tail is appended in argument order and
 * every head offset counts the whole 32-byte head block, which is `args.length` words — the rule
 * the ABI spec states and the one a hand-rolled encoder forgets when it hits its second dynamic
 * argument.
 */
export type Arg =
  | { readonly type: 'uint'; readonly value: bigint }
  | { readonly type: 'address'; readonly value: string }
  | { readonly type: 'address[]'; readonly value: readonly string[] }

export function encodeCall(signature: string, args: readonly Arg[]): string {
  const headWords = args.length
  let head = ''
  let tail = ''
  for (const arg of args) {
    if (arg.type === 'uint') head += encodeUint(arg.value)
    else if (arg.type === 'address') head += encodeAddress(arg.value)
    else {
      head += encodeUint(BigInt(headWords * 32 + tail.length / 2))
      tail += encodeAddressArray(arg.value)
    }
  }
  return selector(signature) + head + tail
}

/** The 32-byte word at slot `index`, as hex with no `0x`, or null if the data is too short. */
function wordAt(data: string, index: number): string | null {
  const bare = data.startsWith('0x') ? data.slice(2) : data
  const start = index * 64
  if (bare.length < start + 64) return null
  return bare.slice(start, start + 64)
}

/**
 * The `uint256` in slot `index`, or **null** when the data is short, empty or not hex.
 *
 * Null rather than `0n`. `eth_call` answers `0x` for a call to an address with no code, and every
 * chain in this estate has addresses with no code — so "the contract is not there" and "the number
 * is zero" arrive as different strings and must stay different values. A UI that renders a reserve
 * of zero for a pair that does not exist is a UI that quotes an infinite price.
 */
export function decodeUintAt(data: string | null, index: number): bigint | null {
  if (data === null) return null
  const word = wordAt(data, index)
  if (word === null) return null
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return null
  return BigInt(`0x${word}`)
}

/** The `address` in slot `index`, lower-cased with `0x`, or null. */
export function decodeAddressAt(data: string | null, index: number): string | null {
  if (data === null) return null
  const word = wordAt(data, index)
  if (word === null) return null
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return null
  // The high 12 bytes of an address word are zero by the spec. A non-zero prefix means we are
  // reading something that is not an address — a length, a uint, the middle of a string — and
  // silently masking it off would turn a decode error into a plausible wrong address.
  if (!/^0{24}/.test(word)) return null
  return `0x${word.slice(24)}`
}

/** The `bool` in slot `index`, or null. Any word other than 0 or 1 is a decode failure. */
export function decodeBoolAt(data: string | null, index: number): boolean | null {
  const value = decodeUintAt(data, index)
  if (value === null) return null
  if (value !== 0n && value !== 1n) return null
  return value === 1n
}

/**
 * A `uint256[]` whose head is in slot `index`, or null.
 *
 * Two reads that can each fail independently and are each checked: the head is a byte offset into
 * the return data, and the word at that offset is a length. A length that would run off the end of
 * the data is a decode failure rather than a short array — a truncated `getAmountsOut` answer is
 * missing the hop that matters, which is always the last one.
 */
export function decodeUintArrayAt(data: string | null, index: number): bigint[] | null {
  const offset = decodeUintAt(data, index)
  if (offset === null || offset % 32n !== 0n) return null
  const base = Number(offset / 32n)
  const length = decodeUintAt(data, base)
  if (length === null) return null
  // A guard against a length word that is really something else: 1024 hops is far beyond any path
  // this surface builds, and allocating on an attacker-supplied length is not a thing to do.
  if (length > 1024n) return null
  const out: bigint[] = []
  for (let i = 0; i < Number(length); i += 1) {
    const item = decodeUintAt(data, base + 1 + i)
    if (item === null) return null
    out.push(item)
  }
  return out
}

/** UTF-8 bytes from a hex run, or null if it is not valid UTF-8. */
function utf8(hex: string): string | null {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** A `string` whose head is in slot `index`, or null. */
export function decodeStringAt(data: string | null, index: number): string | null {
  const offset = decodeUintAt(data, index)
  if (offset === null || offset % 32n !== 0n) return null
  const base = Number(offset / 32n)
  const length = decodeUintAt(data, base)
  if (length === null || length > 4096n) return null
  const bare = (data ?? '').startsWith('0x') ? (data as string).slice(2) : (data ?? '')
  const start = (base + 1) * 64
  const end = start + Number(length) * 2
  if (bare.length < end) return null
  return utf8(bare.slice(start, end))
}

/**
 * A token symbol, from either of the two shapes real ERC-20s return.
 *
 * The standard says `string`. A large minority of tokens — every one written against the pre-2017
 * draft, which includes some of the biggest — return `bytes32`, and the two are indistinguishable
 * from the signature alone. So: try the dynamic decode, and if it fails, treat the first word as a
 * right-padded fixed array and trim it. Both answers are checked for printability, because a symbol
 * that renders as control characters is worse than no symbol.
 *
 * Null means "could not read it", and the caller renders the address instead. It never means the
 * empty string.
 */
export function decodeSymbol(data: string | null): string | null {
  const dynamic = decodeStringAt(data, 0)
  if (dynamic !== null && printable(dynamic)) return dynamic
  const word = wordAt(data ?? '', 0)
  if (word === null) return null
  const trimmed = word.replace(/(00)+$/, '')
  if (trimmed.length === 0 || trimmed.length % 2 !== 0) return null
  const fixed = utf8(trimmed)
  return fixed !== null && printable(fixed) ? fixed : null
}

/**
 * A symbol we are willing to put on the screen.
 *
 * The control-character check is the point. A `bytes32` symbol read out of a slot that was never a
 * symbol decodes to whatever bytes were there, and some of those sequences are valid UTF-8 made of
 * C0 controls — which render as nothing, so the page would show an empty chip beside a real
 * balance. 32 characters is the longest a `bytes32` can hold, and a longer `string` answer is a
 * token trying to break this layout rather than name itself.
 */
function printable(text: string): boolean {
  return text.length > 0 && text.length <= 32 && !/[\u0000-\u001f\u007f]/.test(text)
}

/** Whether a string is a 20-byte hex address. Case-insensitive; says nothing about the checksum. */
export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

/**
 * EIP-55 checksum casing.
 *
 * A lower-case address is valid everywhere and this is presentation only — but it is presentation
 * that carries a check digit, so an address mis-transcribed off this page fails in the reader's
 * wallet rather than in a transaction. Returns the input unchanged when it is not an address, so
 * callers may pass anything.
 */
export function checksumAddress(address: string): string {
  if (!isAddress(address)) return address
  const bare = address.slice(2).toLowerCase()
  const hash = keccak256Utf8(bare).slice(2)
  let out = '0x'
  for (let i = 0; i < bare.length; i += 1) {
    out += Number.parseInt(hash[i] ?? '0', 16) >= 8 ? (bare[i] ?? '').toUpperCase() : bare[i]
  }
  return out
}

/* ── the signatures this surface calls, written once ───────────────────────────────────────────
 *
 * Constants rather than inline strings, so the selector derivation and the transaction builder read
 * the SAME text. A typo in a signature is a different function, and a different function on a router
 * is a revert; a typo in one of two copies of a signature is a revert that only happens in
 * production, because the test asserted the copy it also used.
 */
export const SIG = Object.freeze({
  // Pair, factory, router — the V2 surface.
  getReserves: 'getReserves()',
  token0: 'token0()',
  token1: 'token1()',
  totalSupply: 'totalSupply()',
  getPair: 'getPair(address,address)',
  allPairsLength: 'allPairsLength()',
  allPairs: 'allPairs(uint256)',
  pairCodeHash: 'pairCodeHash()',
  feeTo: 'feeTo()',
  feeToSetter: 'feeToSetter()',
  factory: 'factory()',
  WETH: 'WETH()',
  getAmountsOut: 'getAmountsOut(uint256,address[])',
  quote: 'quote(uint256,uint256,uint256)',
  // ERC-20.
  symbol: 'symbol()',
  decimals: 'decimals()',
  balanceOf: 'balanceOf(address)',
  allowance: 'allowance(address,address)',
  approve: 'approve(address,uint256)',
  // The two swap entry points this surface builds. `SupportingFeeOnTransferTokens` is deliberately
  // absent: no token in this estate takes a transfer fee, and the variant returns nothing, so a UI
  // that used it could not show the reader what they received.
  //
  // ── THE THREE MARKERS BELOW, ARGUED ONCE ────────────────────────────────────────────────────
  //
  // The estate's secret-hygiene check reads a property name through `is_cred()`, which normalises
  // camelCase and matches `_TOKENS_`. In every other repository a `token` in a property name means
  // a bearer credential, and the check is right to stop on one bound to a long string literal — it
  // is the shape beacon used to put a real password in a public repository. Here `Tokens` means
  // ERC-20, this table's values are Solidity function signatures, and a function signature is the
  // most public thing a contract has: it is hashed to a selector and broadcast in the calldata of
  // every transaction that uses it. There is nothing to leak and nothing to rotate.
  //
  // Each line still carries its own reason rather than one blanket suppression, because the marker
  // is per-line by design and a block-wide exemption would silently cover the next property added
  // here — which might not be a signature at all.
  // secret-hygiene: allow a Solidity function signature; `Tokens` here is ERC-20, not a bearer token
  swapExactTokensForTokens:
    'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  // secret-hygiene: allow the router's native-in entry point, named for what it swaps, not a credential
  swapExactETHForTokens: 'swapExactETHForTokens(uint256,address[],address,uint256)',
  // secret-hygiene: allow the native-out entry point; the literal is public calldata on every swap
  swapExactTokensForETH: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
  // Wrapping, for the native coin.
  deposit: 'deposit()',
  withdraw: 'withdraw(uint256)',
})
