/**
 * One chain read, four states.
 *
 * Every screen needs the same four-way answer — loading, ok, empty, failed — and every screen that
 * computes it by hand eventually gets one of the cases wrong: an empty list rendered for a timeout,
 * or a spinner that never resolves. The decision is made once here, as a pure function.
 *
 * ── THIS IS NOT pool-web's `useResource`, AND THE DIFFERENCE IS THE `ApiError` ────────────────
 *
 * There is no `ErrorNotice`, no status code and no `forbidden` state, because there is no API. A
 * chain read either produced a value or it did not: `ethCall` answers `null` on a revert, on a
 * timeout and on a node that is not there, and `market.ts` propagates that null all the way up.
 * Collapsing those into one "could not read" is not a loss of information the page could have used
 * — to a reader trying to swap, a reverted `getReserves` and an unreachable node are the same
 * sentence, and printing a node's internal error text in front of them would be worse than silence.
 *
 * ── EMPTY IS A NORMAL STATE HERE, AND THE COPY HAS TO KNOW IT ────────────────────────────────
 *
 * On 2026-08-16 chain 7411 has exactly one pair, seeded by the estate itself. Neither network in
 * this estate has real users. So an empty pool list is not an incident to apologise for; it is a
 * cold start, and every empty state on this surface is written as one with something to do.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type ResourceState = 'loading' | 'ok' | 'empty' | 'failed'

/**
 * Which state a resource is in.
 *
 * FAILURE OUTRANKS EMPTINESS. A read that returned null has told us nothing about whether anything
 * exists, so reporting "no pools here" for an unreachable node is how an outage reads as a chain
 * with no markets on it.
 */
export function resourceState(opts: {
  readonly loading: boolean
  readonly failed: boolean
  readonly count: number | null
  /**
   * Whether the read is switched on at all. Defaults to true.
   *
   * A DISABLED READ IS NOT A PENDING ONE, and conflating them is a spinner that never stops. With
   * `count: null` and nothing loading, the only honest reading used to be "the answer has not come
   * back yet" — which is right for a read in flight and wrong for one that was never started. The
   * swap page's quote is disabled until there is an amount and a pool behind it, so every reader
   * arriving on this surface saw "…" in the "You receive" field, forever, for a request nobody had
   * made. What belongs there is the em dash: there is no quote, and none is coming until they type.
   */
  readonly enabled?: boolean
}): ResourceState {
  if (opts.failed) return 'failed'
  if (opts.enabled === false) return 'empty'
  if (opts.loading) return 'loading'
  if (opts.count === null) return 'loading'
  return opts.count > 0 ? 'ok' : 'empty'
}

export interface Resource<T> {
  readonly data: T | null
  readonly state: ResourceState
  readonly reload: () => void
}

/**
 * Run a read, and re-run it when its dependencies change or the reader asks.
 *
 * ── `enabled` IS WHAT STOPS THIS SURFACE TALKING TO A CHAIN THAT HAS NO EXCHANGE ─────────────
 *
 * Every page below `ChainProvider` passes `chain.status === 'ready'`. On a network with no
 * deployment this console therefore issues NO calls at all, rather than one per page that fails and
 * renders as a fault. The pool console learned that the expensive way (micro-org#406): a page
 * deployed to explain a deliberate absence reported it as an outage, because nothing told it the
 * difference.
 *
 * ── THE STALE-RESPONSE GUARD IS NOT OPTIONAL ────────────────────────────────────────────────
 *
 * A reader typing into the swap box fires a read per keystroke, and they do not come back in order.
 * Without the sequence check the quote on screen is whichever request happened to finish last —
 * which, for somebody who typed `1` then `10`, is frequently the quote for `1` sitting under the
 * amount `10`. The counter is compared on arrival and a superseded answer is dropped.
 */
export function useResource<T>(
  read: () => Promise<T | null>,
  deps: readonly unknown[],
  opts: { readonly enabled?: boolean; readonly count?: (data: T) => number } = {},
): Resource<T> {
  const enabled = opts.enabled ?? true
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const sequence = useRef(0)
  // Held in a ref so the effect below does not have to list them as dependencies. `read` is a
  // fresh closure on every render and `count` frequently an inline arrow; depending on either
  // would re-run the read forever, which on this surface means a request per frame to a public
  // node. The caller declares what the read really depends on, in `deps`.
  const latest = useRef({ read, count: opts.count })
  latest.current = { read, count: opts.count }

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      setData(null)
      setFailed(false)
      return
    }
    const mine = sequence.current + 1
    sequence.current = mine
    setLoading(true)
    setFailed(false)
    void (async () => {
      let answer: T | null = null
      let threw = false
      try {
        answer = await latest.current.read()
      } catch {
        // Deliberately not read. `rpc.ts` explains why a caught exception from `fetch` is never
        // printed in this estate: it carries the request URL.
        threw = true
      }
      if (sequence.current !== mine) return
      setData(answer)
      setFailed(threw || answer === null)
      setLoading(false)
    })()
  }, [enabled, nonce, ...deps])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const count = data === null ? null : (latest.current.count?.(data) ?? 1)
  return { data, state: resourceState({ loading, failed, count, enabled }), reload }
}
