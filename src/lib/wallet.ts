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
