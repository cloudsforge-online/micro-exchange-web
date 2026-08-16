/**
 * "Which chain is in front of me, and is there an exchange on it?" — asked once, at the root.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS REPLACES micro-pool-web's `deployment.json`, AND IT IS A BETTER ANSWER TO THE SAME QUESTION.
 *
 * The pool console needed a document from its own nginx container because "is micro-pool deployed
 * on this estate" is not a thing a browser can find out — the service is either behind the gateway
 * or it is not, and a 502 is indistinguishable from an outage. So a runtime environment variable
 * was rendered into a `/deployment.json` for the bundle to read.
 *
 * The exchange has no such gap. "Are the contracts on this chain" is answered by the chain, in one
 * `eth_chainId`, from the reader's own browser. So there is no `deployment.inc.template` in this
 * repository, no `POOL_API_PRESENCE`-shaped variable, and no way for a deploy to be WRONG about
 * whether this surface works — the page believes the node it is reading and nothing else.
 *
 * ── `unknown` IS A STATE AND IT RENDERS AS A LOADING PAGE, NOT AS ABSENCE ────────────────────
 *
 * Defaulting to "no exchange here" until told otherwise would flash "this network does not run
 * Forge Exchange" on every cold load of the exchange's own page, which is the mirror of the defect
 * micro-org#406 recorded on the pool. Defaulting to "there is one" would render a swap form that
 * cannot quote. So the third state exists and is rendered as itself.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { blockNumber, chainId as readChainId, rpcUrl } from './rpc.ts'
import { deploymentFor, type Deployment } from './dex.ts'
import { viewedNetwork } from './viewed.ts'

export interface ChainState {
  /** `unknown` until the first `eth_chainId` answers. */
  readonly status: 'unknown' | 'ready' | 'no-exchange' | 'unreachable'
  /** The chain the endpoint reports, once it has. */
  readonly chainId: number | null
  /** The contracts, when this chain has them. */
  readonly deployment: Deployment | null
  /** The head at the moment the page loaded. Every number on the page is as of about this block. */
  readonly head: number | null
  /** Re-read the head and the chain id. */
  readonly refresh: () => void
}

const FALLBACK: ChainState = {
  status: 'unknown',
  chainId: null,
  deployment: null,
  head: null,
  refresh: () => {},
}

const ChainContext = createContext<ChainState>(FALLBACK)

export function ChainProvider({ children }: { readonly children: ReactNode }) {
  const [chainId, setChainId] = useState<number | null>(null)
  const [head, setHead] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)
  const [nonce, setNonce] = useState(0)
  // The endpoint changes when the reader switches network, and the whole answer has to be re-asked
  // rather than kept — a chain id from the estate they were looking at a moment ago is the most
  // convincing wrong answer this page could hold.
  const network = viewedNetwork()

  useEffect(() => {
    let live = true
    setSettled(false)
    void (async () => {
      const id = await readChainId()
      if (!live) return
      setChainId(id)
      setSettled(true)
      const at = await blockNumber()
      if (live) setHead(at)
    })()
    return () => {
      live = false
    }
  }, [nonce, network])

  const value = useMemo<ChainState>(() => {
    const deployment = deploymentFor(chainId)
    const status: ChainState['status'] = !settled
      ? 'unknown'
      : rpcUrl() === null || chainId === null
        ? 'unreachable'
        : deployment === null
          ? 'no-exchange'
          : 'ready'
    return { status, chainId, deployment, head, refresh: () => setNonce((n) => n + 1) }
  }, [chainId, head, settled])

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>
}

/** The chain, from anywhere below the provider. */
export function useChain(): ChainState {
  return useContext(ChainContext)
}
