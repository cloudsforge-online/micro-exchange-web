/**
 * The wallet hand-off. Everything this app knows about a browser wallet lives here.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * NOTHING IN THIS ESTATE CUSTODIES A SWAP, AND THIS FILE IS WHERE THAT IS TRUE.
 *
 * A V2 router takes tokens from `msg.sender` and sends the proceeds to `to`. Both are the reader's
 * own address; CloudsForge is not a party to the transaction and holds nothing at any point in it.
 * So this seam's job is TRANSPARENCY: show the router the money is going to, show the path, show
 * the minimum that will be accepted, and hand all three to the wallet unchanged.
 *
 * ── WHY THE TRANSACTION BUILDERS ARE PURE FUNCTIONS ──────────────────────────────────────────
 *
 * `buildSwapTransaction` and `buildApproveTransaction` take data and return an object. They touch
 * no provider, so `test/wallet.test.ts` asserts the exact `to`, `data`, `value` and `from` that
 * would have been signed. That is the assertion that matters: a test that stubs a provider and
 * checks the promise resolves proves the plumbing and not the payload, and the payload is the part
 * that moves somebody's coins to an address.
 *
 * ── THE DEADLINE IS COMPUTED HERE AND NOWHERE ELSE ───────────────────────────────────────────
 *
 * Every V2 entry point takes a `deadline`, and a UI that passes `type(uint256).max` — which many
 * do — has removed the protection the argument exists for: a transaction that sits unmined in a
 * mempool for an hour and then executes against a price nobody would accept. The builder takes an
 * explicit `nowSeconds` rather than reading the clock, so the test can pin the arithmetic and so
 * this file has no hidden input.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { encodeCall, SIG } from './abi.ts'

/** EIP-1193, narrowed to the methods this app calls. */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

export class WalletError extends Error {
  /** EIP-1193 error codes. 4001 is "user rejected", which is not a failure and is not reported. */
  readonly code: number | undefined
  constructor(message: string, code?: number) {
    super(message)
    this.name = 'WalletError'
    this.code = code
  }
}

/** EIP-1193 §5: the user rejected the request. A decision, not an error to report or retry. */
export const USER_REJECTED = 4001

/** True when this failure was the user saying no. */
export function isUserRejection(err: unknown): boolean {
  return err instanceof WalletError && err.code === USER_REJECTED
}

/**
 * The injected provider, or `null`.
 *
 * `null` is a first-class answer, not an error. A reader with no wallet can still see the reserves,
 * the curve, every contract address and what any amount would fill at — because all of that is read
 * over the public RPC in `rpc.ts`, not through the wallet. What they cannot do is sign, and the
 * page says so at the point where signing would have happened rather than by refusing to render.
 * That distinction is the whole reason reads do not go through the provider here, unlike in
 * foresight-web where the chain read is a fallback for a stale mirror.
 */
export function getProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
  return injected && typeof injected.request === 'function' ? injected : null
}

/** A transaction as `eth_sendTransaction` takes it — every field `0x`-prefixed hex or an address. */
export interface TransactionRequest {
  readonly from: string
  readonly to: string
  readonly data: string
  /** Wei, as a minimal hex quantity. Present even when zero, so the field is never ambiguous. */
  readonly value: string
}

/** Wei as a minimal `0x` hex quantity, which is what the JSON-RPC spec requires — no leading zeros. */
export function toQuantity(wei: bigint): string {
  if (wei < 0n) throw new WalletError('a quantity cannot be negative')
  return `0x${wei.toString(16)}`
}

/**
 * How long a swap may sit in a mempool before it must not execute.
 *
 * Twenty minutes, the V2 interface's own default, and stated as a constant so the number is
 * arguable rather than buried. Shorter would fail honest transactions on a chain with slow blocks;
 * longer starts to approximate the no-deadline case this exists to avoid.
 */
export const DEADLINE_SECONDS = 20 * 60

/**
 * The deadlines a reader may choose from on the liquidity pages, in minutes.
 *
 * THREE, AND NO FREE-TEXT FIELD, for the reason `swap.tsx` gives about the tolerance: a box invites
 * a number nobody meant. Ten minutes is short enough to be a real protection on a chain with
 * five-second blocks and long enough to survive a wallet the reader walked away from; an hour is
 * the outer end of what is still a deadline rather than a formality. The default is the middle one
 * and equals `DEADLINE_SECONDS`, so the swap form and the liquidity forms agree without one of them
 * having to import the other's list.
 */
export const DEADLINE_CHOICES: readonly { readonly minutes: number; readonly label: string }[] = [
  { minutes: 10, label: '10 minutes' },
  { minutes: 20, label: '20 minutes' },
  { minutes: 60, label: '1 hour' },
]

/**
 * The absolute ceiling on a deadline this bundle will encode, whatever it is asked for.
 *
 * A day. The argument exists to stop a transaction executing against a price nobody would accept
 * after sitting in a mempool, and a deadline measured in weeks — or the `type(uint256).max` that
 * several well-known frontends send — has thrown that protection away while still passing the
 * router's `require`. This is a guard on the BUILDER rather than on the form, so a future page that
 * forgets to validate its own input cannot get past it.
 */
export const MAX_DEADLINE_SECONDS = 24 * 60 * 60

/** `now + window`, as the `uint256` every V2 entry point takes. Throws on a window it will not send. */
function deadlineAt(nowSeconds: number, windowSeconds: number): bigint {
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) throw new WalletError('the clock is not a time')
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new WalletError('a deadline must be in the future')
  }
  if (windowSeconds > MAX_DEADLINE_SECONDS) {
    throw new WalletError('a deadline that far out is not a deadline')
  }
  return BigInt(Math.floor(nowSeconds) + Math.floor(windowSeconds))
}

/**
 * The swap transaction.
 *
 * ── THREE SHAPES, BECAUSE THE NATIVE COIN IS NOT A TOKEN ─────────────────────────────────────
 *
 * EMBER has no `transferFrom`, so a swap that starts or ends in it cannot use the token entry
 * point. The router's answer is `swapExactETHForTokens`, which takes the input as `value` and NOT
 * as an argument, and `swapExactTokensForETH`, which unwraps at the end. Picking the wrong one is
 * not a revert — `swapExactTokensForTokens` with a WEMBER path and no approval reverts, but a
 * `swapExactETHForTokens` whose `value` does not match its first path element is a transaction that
 * SUCCEEDS and swaps the wrong amount. So the shape is decided here, from the path, once.
 *
 * `path[0]` and `path[path.length - 1]` are the wrapped address in both native cases, because that
 * is what the router requires: it wraps or unwraps at the boundary and routes through pairs the
 * whole way. The caller passes the wrapped address and a flag, rather than a sentinel address, so
 * there is no magic value to get wrong.
 */
export function buildSwapTransaction(opts: {
  readonly router: string
  readonly path: readonly string[]
  readonly amountIn: bigint
  readonly amountOutMin: bigint
  readonly from: string
  readonly nowSeconds: number
  /** True when the reader is spending the native coin. */
  readonly fromNative: boolean
  /** True when the reader is receiving the native coin. */
  readonly toNative: boolean
}): TransactionRequest {
  const { router, path, amountIn, amountOutMin, from, nowSeconds, fromNative, toNative } = opts
  if (amountIn <= 0n) throw new WalletError('a swap must be more than zero')
  if (path.length < 2) throw new WalletError('a swap needs a path of at least two tokens')
  if (fromNative && toNative) throw new WalletError('a swap cannot be native on both sides')
  if (!router) throw new WalletError('there is no router on this network')

  const deadline = BigInt(Math.floor(nowSeconds) + DEADLINE_SECONDS)

  if (fromNative) {
    return {
      from,
      to: router,
      data: encodeCall(SIG.swapExactETHForTokens, [
        { type: 'uint', value: amountOutMin },
        { type: 'address[]', value: path },
        { type: 'address', value: from },
        { type: 'uint', value: deadline },
      ]),
      // The input is the value, and it is the ONLY place the input appears. There is no
      // `amountIn` argument on this entry point, which is exactly why the shape is chosen here.
      value: toQuantity(amountIn),
    }
  }

  const signature = toNative ? SIG.swapExactTokensForETH : SIG.swapExactTokensForTokens
  return {
    from,
    to: router,
    data: encodeCall(signature, [
      { type: 'uint', value: amountIn },
      { type: 'uint', value: amountOutMin },
      { type: 'address[]', value: path },
      { type: 'address', value: from },
      { type: 'uint', value: deadline },
    ]),
    value: '0x0',
  }
}

/**
 * The approval a token swap needs before it can be sent.
 *
 * ── THE AMOUNT IS THE SWAP, NOT INFINITY ─────────────────────────────────────────────────────
 *
 * Approving `type(uint256).max` is the industry default and it is the reason a router bug is a
 * total loss rather than a bounded one: an unlimited allowance survives the transaction that
 * prompted it, so every token a reader ever holds afterwards is spendable by that contract for as
 * long as it exists. This page approves exactly what is about to be swapped. The cost is one extra
 * signature per swap, paid by the reader in gas and in attention; the benefit is that an allowance
 * left behind by this UI can never be worth more than the trade the reader had already decided to
 * make.
 */
export function buildApproveTransaction(opts: {
  readonly token: string
  readonly spender: string
  readonly amount: bigint
  readonly from: string
}): TransactionRequest {
  const { token, spender, amount, from } = opts
  if (!token || !spender) throw new WalletError('an approval needs a token and a spender')
  if (amount <= 0n) throw new WalletError('an approval must be more than zero')
  return {
    from,
    to: token,
    data: encodeCall(SIG.approve, [
      { type: 'address', value: spender },
      { type: 'uint', value: amount },
    ]),
    value: '0x0',
  }
}

/**
 * The deposit.
 *
 * ── FOUR NUMBERS, AND ONLY TWO OF THEM ARE ENFORCEABLE ───────────────────────────────────────
 *
 * `amountADesired`/`amountBDesired` are what the reader would like to put in. The router does NOT
 * necessarily take them: `_addLiquidity` recomputes the second side from the reserves at the block
 * it executes in, and deposits the smaller consistent pair, refunding nothing — it simply takes
 * less of one side. The numbers that bind are `amountAMin`/`amountBMin`, which is where a slippage
 * tolerance actually lives on this page. Set them to the desired amounts and any movement at all
 * reverts; set them to zero and the reader has agreed to deposit at whatever ratio exists when the
 * block lands, which for a pool somebody has just drained is a very different trade from the one on
 * the screen. `INSUFFICIENT_A_AMOUNT` and `INSUFFICIENT_B_AMOUNT` are the two reverts those produce
 * and the page names them.
 *
 * ── THE NATIVE SIDE IS `value` AND IS NOT AN ARGUMENT ────────────────────────────────────────
 *
 * Same trap as the swap: `addLiquidityETH` takes ONE token and infers the other side from the value
 * sent, so building the token-token form for a pair containing the wrapped coin asks the reader for
 * an allowance on WEMBER they have no reason to hold. Which shape to use is decided here, once,
 * from a flag rather than from a sentinel address.
 *
 * ── FIRST DEPOSIT INTO AN EMPTY POOL ─────────────────────────────────────────────────────────
 *
 * There is no branch for it here and there must not be one: to the router a first deposit is the
 * same call. The difference is entirely in what it MEANS — the ratio deposited becomes the price,
 * and no arbitrage puts it back — and that belongs on the screen at the moment of signing, which is
 * where `pages/add-liquidity.tsx` puts it.
 */
export function buildAddLiquidityTransaction(opts: {
  readonly router: string
  readonly tokenA: string
  readonly tokenB: string
  readonly amountADesired: bigint
  readonly amountBDesired: bigint
  readonly amountAMin: bigint
  readonly amountBMin: bigint
  readonly from: string
  readonly nowSeconds: number
  /** True when side A is the chain's native coin, which travels as `value`. */
  readonly aNative: boolean
  /** True when side B is the chain's native coin. */
  readonly bNative: boolean
  readonly deadlineSeconds?: number
}): TransactionRequest {
  const { router, tokenA, tokenB, from, aNative, bNative } = opts
  const { amountADesired, amountBDesired, amountAMin, amountBMin } = opts
  if (!router) throw new WalletError('there is no router on this network')
  if (amountADesired <= 0n || amountBDesired <= 0n) {
    throw new WalletError('a deposit needs an amount on both sides')
  }
  if (amountAMin > amountADesired || amountBMin > amountBDesired) {
    throw new WalletError('a minimum cannot be larger than the amount it is a minimum of')
  }
  if (aNative && bNative) throw new WalletError('a deposit cannot be native on both sides')
  if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
    throw new WalletError('a pool holds two different tokens')
  }
  const deadline = deadlineAt(opts.nowSeconds, opts.deadlineSeconds ?? DEADLINE_SECONDS)

  if (aNative || bNative) {
    // The router's argument order is (token, tokenDesired, tokenMin, ethMin) — the TOKEN side
    // first, whichever side of the form it came from. Getting this the wrong way round is a
    // transaction that succeeds and deposits the minimum of the two, which is not a revert anybody
    // sees.
    const token = aNative ? tokenB : tokenA
    const tokenDesired = aNative ? amountBDesired : amountADesired
    const tokenMin = aNative ? amountBMin : amountAMin
    const nativeDesired = aNative ? amountADesired : amountBDesired
    const nativeMin = aNative ? amountAMin : amountBMin
    return {
      from,
      to: router,
      data: encodeCall(SIG.addLiquidityETH, [
        { type: 'address', value: token },
        { type: 'uint', value: tokenDesired },
        { type: 'uint', value: tokenMin },
        { type: 'uint', value: nativeMin },
        { type: 'address', value: from },
        { type: 'uint', value: deadline },
      ]),
      value: toQuantity(nativeDesired),
    }
  }

  return {
    from,
    to: router,
    data: encodeCall(SIG.addLiquidity, [
      { type: 'address', value: tokenA },
      { type: 'address', value: tokenB },
      { type: 'uint', value: amountADesired },
      { type: 'uint', value: amountBDesired },
      { type: 'uint', value: amountAMin },
      { type: 'uint', value: amountBMin },
      { type: 'address', value: from },
      { type: 'uint', value: deadline },
    ]),
    value: '0x0',
  }
}

/**
 * The withdrawal.
 *
 * `liquidity` is an amount of the PAIR's own ERC-20, which the router has to be allowed to move —
 * so this is the one flow on the surface where the token being approved is the pool itself, and the
 * page says so rather than showing a bare address. The two minimums are what stops a withdrawal
 * from executing against reserves somebody moved in the meantime; unlike the deposit, both sides
 * come out in proportion, so the tolerance applies to both symmetrically.
 */
export function buildRemoveLiquidityTransaction(opts: {
  readonly router: string
  readonly tokenA: string
  readonly tokenB: string
  readonly liquidity: bigint
  readonly amountAMin: bigint
  readonly amountBMin: bigint
  readonly from: string
  readonly nowSeconds: number
  readonly aNative: boolean
  readonly bNative: boolean
  readonly deadlineSeconds?: number
}): TransactionRequest {
  const { router, tokenA, tokenB, liquidity, amountAMin, amountBMin, from } = opts
  const { aNative, bNative } = opts
  if (!router) throw new WalletError('there is no router on this network')
  if (liquidity <= 0n) throw new WalletError('a withdrawal must be more than zero')
  if (aNative && bNative) throw new WalletError('a pool cannot be native on both sides')
  if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
    throw new WalletError('a pool holds two different tokens')
  }
  const deadline = deadlineAt(opts.nowSeconds, opts.deadlineSeconds ?? DEADLINE_SECONDS)

  if (aNative || bNative) {
    return {
      from,
      to: router,
      data: encodeCall(SIG.removeLiquidityETH, [
        { type: 'address', value: aNative ? tokenB : tokenA },
        { type: 'uint', value: liquidity },
        { type: 'uint', value: aNative ? amountBMin : amountAMin },
        { type: 'uint', value: aNative ? amountAMin : amountBMin },
        { type: 'address', value: from },
        { type: 'uint', value: deadline },
      ]),
      value: '0x0',
    }
  }

  return {
    from,
    to: router,
    data: encodeCall(SIG.removeLiquidity, [
      { type: 'address', value: tokenA },
      { type: 'address', value: tokenB },
      { type: 'uint', value: liquidity },
      { type: 'uint', value: amountAMin },
      { type: 'uint', value: amountBMin },
      { type: 'address', value: from },
      { type: 'uint', value: deadline },
    ]),
    value: '0x0',
  }
}

/**
 * Creating a market, straight at the factory.
 *
 * ── THIS IS SEPARATE FROM THE FIRST DEPOSIT, AND THAT IS THE HONEST SHAPE ────────────────────
 *
 * The router creates a missing pair on its way through `addLiquidity`, so most people will never
 * send this transaction: they will deposit into a pair that does not exist yet and get both in one
 * signature, which is cheaper and is what the add-liquidity page does. This exists because an empty
 * pair is a legitimate thing to want — a market can be created and left for somebody else to seed —
 * and because a page that only ever created pairs as a side effect of a deposit could not explain
 * what the deposit was doing.
 *
 * The three ways it fails are all decidable before it is sent: the same token twice, the zero
 * address, and a pair that already exists. The page checks all three, because the factory's revert
 * strings reach a reader as "execution reverted" and nothing else.
 */
export function buildCreatePairTransaction(opts: {
  readonly factory: string
  readonly tokenA: string
  readonly tokenB: string
  readonly from: string
}): TransactionRequest {
  const { factory, tokenA, tokenB, from } = opts
  if (!factory) throw new WalletError('there is no factory on this network')
  if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
    throw new WalletError('a pool holds two different tokens')
  }
  if (/^0x0{40}$/.test(tokenA) || /^0x0{40}$/.test(tokenB)) {
    throw new WalletError('the zero address is not a token')
  }
  return {
    from,
    to: factory,
    data: encodeCall(SIG.createPair, [
      { type: 'address', value: tokenA },
      { type: 'address', value: tokenB },
    ]),
    value: '0x0',
  }
}

/** Wrapping the native coin: `deposit()` with the amount as `value`. */
export function buildWrapTransaction(opts: {
  readonly wrapped: string
  readonly amount: bigint
  readonly from: string
}): TransactionRequest {
  if (opts.amount <= 0n) throw new WalletError('a wrap must be more than zero')
  return {
    from: opts.from,
    to: opts.wrapped,
    data: encodeCall(SIG.deposit, []),
    value: toQuantity(opts.amount),
  }
}

/* ------------------------------------------------------------------ the provider calls */

/** Normalise whatever a wallet threw into a `WalletError` with its code, if it had one. */
function walletError(err: unknown, fallback: string): WalletError {
  if (err instanceof WalletError) return err
  const shaped = err as { code?: unknown; message?: unknown }
  const code = typeof shaped?.code === 'number' ? shaped.code : undefined
  const message = typeof shaped?.message === 'string' && shaped.message ? shaped.message : fallback
  return new WalletError(message, code)
}

/** Ask for accounts. Opens the wallet's own prompt; the user may say no, and that is not an error. */
export async function requestAccounts(provider: Eip1193Provider): Promise<readonly string[]> {
  try {
    const result = await provider.request({ method: 'eth_requestAccounts' })
    return Array.isArray(result) ? result.filter((a): a is string => typeof a === 'string') : []
  } catch (err) {
    throw walletError(err, 'the wallet did not return an account')
  }
}

/** The accounts already granted, without prompting. Empty is the normal answer for a cold page. */
export async function currentAccounts(provider: Eip1193Provider): Promise<readonly string[]> {
  try {
    const result = await provider.request({ method: 'eth_accounts' })
    return Array.isArray(result) ? result.filter((a): a is string => typeof a === 'string') : []
  } catch {
    // A wallet that will not answer `eth_accounts` is a wallet this page treats as absent. It is
    // not worth a failure state: nothing has been attempted yet.
    return []
  }
}

/**
 * The chain the wallet is currently on, or null.
 *
 * READ, AND COMPARED, BEFORE ANY SIGNATURE IS OFFERED. A wallet on the wrong chain will happily
 * sign a transaction to the router's address on THAT chain — where there is either no code, or,
 * far worse, somebody else's contract at the same address. The addresses in `dex.ts` are facts
 * about chain 7411 and mean nothing anywhere else.
 */
export async function walletChainId(provider: Eip1193Provider): Promise<number | null> {
  try {
    const hex = await provider.request({ method: 'eth_chainId' })
    if (typeof hex !== 'string') return null
    const value = Number(BigInt(hex))
    return Number.isSafeInteger(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Ask the wallet to switch chains. Resolves true when it did, false when the wallet declined or
 * does not know the chain.
 *
 * `wallet_addEthereumChain` is deliberately NOT attempted on 4902 ("unrecognised chain"). Adding a
 * chain writes an RPC endpoint into somebody's wallet permanently, and this page is not the right
 * place to ask for that — Forge Network publishes the details, and a reader who adds the chain
 * from there has read what they are adding. Here, a false is rendered as an instruction.
 */
export async function switchChain(provider: Eip1193Provider, chainId: number): Promise<boolean> {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    })
    return true
  } catch {
    return false
  }
}

/** Send a transaction. Returns the hash the chain will know it by. */
export async function sendTransaction(
  provider: Eip1193Provider,
  tx: TransactionRequest,
): Promise<string> {
  try {
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] })
    if (typeof hash !== 'string' || !hash.startsWith('0x')) {
      throw new WalletError('the wallet did not return a transaction hash')
    }
    return hash
  } catch (err) {
    throw walletError(err, 'the transaction was not sent')
  }
}
