/**
 * Reads, over the estate's public JSON-RPC.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS SURFACE READS THE CHAIN DIRECTLY, AND HAS NO API OF ITS OWN.
 *
 * Every other frontend in the estate calls a CloudsForge service that reads a database. There is no
 * `micro-exchange` service and there should not be one: an AMM's entire state is four numbers in a
 * contract, and a service in front of them could only ever be a cache that is wrong between blocks.
 * A reader who wants to know what a swap will fill at should be asking the chain that will fill it.
 *
 * So the address here is `rpc{suffix}` — the same public endpoint the network page publishes for
 * anybody's wallet, routed by `cf-api-rpc` in `deploy/gateway/dynamic/estate-web.yml` and rate
 * limited by `cf-rpc-throttle`. It is composed from the page's own apex, never written down, for
 * the reason `test/no-build-time-config.test.ts` gives.
 *
 * ── IT IS CROSS-ORIGIN, AND THAT IS A DEPLOY FACT THIS FILE DEPENDS ON ───────────────────────
 *
 * `exchange.<apex>` calling `rpc.<apex>` is cross-origin, so it needs this surface's origin in the
 * `cf-cors` allowlist in `deploy/gateway/dynamic/policy.yml`. That list is derived from the surface
 * registry's `servesUi` flag by `surface-routes.py` check 5, so flipping `exchange` to
 * `servesUi: true` is what grants it — there is no separate entry to remember. MEASURED before this
 * surface existed: `OPTIONS https://rpc.cloudsforge.online/ -H 'Origin: https://exchange...'`
 * answered 200 with `access-control-allow-credentials: true` and NO
 * `access-control-allow-origin`, which a browser reads as a refusal. Every other surface's origin
 * got one. That was the gap and the registry flip is what closes it.
 *
 * No credential is ever sent. `credentials` is left at its default of `omit`, because a chain read
 * is public and a cookie on it would be a cookie sent to an endpoint that has no use for one.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { viewedNetwork } from './viewed.ts'
import { isLocal } from './hosts.ts'

/** A JSON-RPC failure that carries the node's own message. Never carries the request URL. */
export class RpcError extends Error {
  readonly code: number
  constructor(message: string, code: number) {
    super(message)
    this.name = 'RpcError'
    this.code = code
  }
}

/**
 * The RPC endpoint for the network the reader is VIEWING.
 *
 * `viewedNetwork()` rather than the hostname, so pressing Testnet re-points the chain this page
 * reads instead of navigating away from it (micro-org#459). The suffix is composed the same way
 * `viewedHosts()` composes every other address, and the apex comes off the page.
 *
 * Null on a local stack and on any address the registry cannot split. There is no localhost default
 * — a dev port guessed for a chain node is a guess that fails as a connection refused with no
 * explanation, and this page's own "no exchange on this network" state is a better answer than a
 * spinner. Set up a node and open the page against a real estate.
 */
export function rpcUrl(): string | null {
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname
  if (isLocal(hostname)) return null
  const parts = hostname.split('.')
  if (parts.length <= 2) return null
  const apex = parts.slice(1).join('.')
  const label = viewedNetwork() === 'testnet' ? 'rpc-testnet' : 'rpc'
  return `https://${label}.${apex}`
}

let nextId = 1

/**
 * One JSON-RPC call.
 *
 * ── THE ERROR NEVER CARRIES THE URL, AND THAT IS A HARD RULE IN THIS ESTATE ──────────────────
 *
 * A `fetch` rejection in Node and in browsers puts the whole request URL in the exception message,
 * and an RPC URL with a credential in it — which some estates use, and which this one has used —
 * is then printed by any handler that logs `err.message`. That is exactly how bitcoind's `rpcauth`
 * leaked once, and no redaction rule catches it because the leak is inside a string that looks like
 * prose. So every throw here is constructed from the node's own `error.message`, or from a fixed
 * sentence, and the caught exception is discarded without being read.
 */
export async function rpc<T>(method: string, params: readonly unknown[] = []): Promise<T> {
  const url = rpcUrl()
  if (url === null) throw new RpcError('There is no chain endpoint for this address.', -1)

  const id = nextId
  nextId += 1

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
  } catch {
    // Deliberately not `catch (err)`. See above.
    throw new RpcError('The chain endpoint could not be reached.', -2)
  }

  if (!response.ok) {
    // The status is safe to name; the URL that produced it is not, and `response.url` is the same
    // string the exception above would have carried.
    throw new RpcError(`The chain endpoint answered ${response.status}.`, -response.status)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new RpcError('The chain endpoint answered something that was not JSON.', -3)
  }

  const envelope = body as { result?: unknown; error?: { message?: unknown; code?: unknown } }
  if (envelope.error) {
    const message =
      typeof envelope.error.message === 'string' ? envelope.error.message : 'The call failed.'
    const code = typeof envelope.error.code === 'number' ? envelope.error.code : 0
    throw new RpcError(message, code)
  }
  return envelope.result as T
}

/** The chain id the endpoint reports, as a number, or null if it cannot be read. */
export async function chainId(): Promise<number | null> {
  try {
    const hex = await rpc<string>('eth_chainId')
    const value = Number(BigInt(hex))
    return Number.isSafeInteger(value) ? value : null
  } catch {
    return null
  }
}

/** The head block number, or null. */
export async function blockNumber(): Promise<number | null> {
  try {
    const hex = await rpc<string>('eth_blockNumber')
    const value = Number(BigInt(hex))
    return Number.isSafeInteger(value) ? value : null
  } catch {
    return null
  }
}

/**
 * `eth_call` against the latest block. **Returns null on any failure**, including a revert.
 *
 * Null rather than a throw, and the decoders in `abi.ts` take `string | null` for exactly this
 * reason: a read that failed and a read that answered zero must not become the same value on the
 * way to the screen. A caller that needs to tell a revert from an outage should not be using this
 * function — nothing on this surface does, because to a reader "the pool did not answer" is the
 * same sentence either way, and pretending otherwise would put a node's internal error text in
 * front of somebody trying to swap.
 */
export async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    return await rpc<string>('eth_call', [{ to, data }, 'latest'])
  } catch {
    return null
  }
}

/** A native balance in wei, or null. */
export async function balance(address: string): Promise<bigint | null> {
  try {
    return BigInt(await rpc<string>('eth_getBalance', [address, 'latest']))
  } catch {
    return null
  }
}
