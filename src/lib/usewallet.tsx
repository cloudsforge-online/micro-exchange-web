/**
 * The connected address and the wallet's chain, as a hook.
 *
 * ── IT DOES NOT PROMPT ON MOUNT, DELIBERATELY ────────────────────────────────────────────────
 *
 * `eth_accounts` returns what the reader has ALREADY granted this origin and opens nothing;
 * `eth_requestAccounts` is the one that puts a dialogue in front of them. A page that prompts on
 * load is a page people dismiss before they have read anything — and every number on this surface
 * is readable without a wallet existing at all, because the reads go over the public RPC in
 * `lib/rpc.ts` rather than through the provider.
 *
 * So: silent on mount, prompt only from `connect()`, and `address: null` is a first-class state the
 * pages render around rather than block on. A reader with no wallet sees the reserves, the curve,
 * the quote for any amount they type and every contract address. What they cannot do is sign.
 *
 * ── THE CHAIN IS TRACKED SEPARATELY FROM THE CHAIN THE PAGE IS READING ───────────────────────
 *
 * `useChain()` is the chain behind the public RPC — the one the numbers on screen came from.
 * `chainId` here is the chain the reader's WALLET is on, which is a different fact and frequently a
 * different number. They must agree before a signature is offered: a wallet on the wrong chain will
 * sign a transaction to the router's address over THERE, where there is either no code or, far
 * worse, somebody else's contract at the same address. `swap.tsx` compares them and offers the
 * switch rather than the button.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  currentAccounts,
  getProvider,
  isUserRejection,
  requestAccounts,
  switchChain,
  walletChainId,
} from './wallet.ts'

export interface WalletState {
  /** The first granted account, lower-cased, or `null`. */
  readonly address: string | null
  /** The chain the wallet is on, or null when it will not say. */
  readonly chainId: number | null
  /** False when there is no injected provider at all. */
  readonly available: boolean
  readonly connecting: boolean
  /** Set when a connection attempt failed for a reason that was not the user declining. */
  readonly error: string | null
  connect: () => void
  /** Ask the wallet to move to a chain. Resolves false when it declined or does not know it. */
  requestChain: (chainId: number) => Promise<boolean>
}

export function useWalletAddress(): WalletState {
  const provider = useMemo(() => getProvider(), [])
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!provider) return
    let live = true
    void currentAccounts(provider).then((accounts) => {
      if (live) setAddress(accounts[0]?.toLowerCase() ?? null)
    })
    void walletChainId(provider).then((id) => {
      if (live) setChainId(id)
    })

    // A reader who switches account in their wallet is a different holder, and every balance on the
    // page belongs to the old one until this fires.
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0]
      setAddress(
        Array.isArray(accounts) ? ((accounts[0] as string | undefined)?.toLowerCase() ?? null) : null,
      )
    }
    // And a reader who switches NETWORK has invalidated the only check standing between them and a
    // transaction sent to an address on the wrong chain. This listener is the reason the check is
    // trustworthy at the moment the button is pressed rather than only at mount.
    const onChain = (...args: unknown[]) => {
      const raw = args[0]
      if (typeof raw !== 'string') {
        setChainId(null)
        return
      }
      try {
        const value = Number(BigInt(raw))
        setChainId(Number.isSafeInteger(value) ? value : null)
      } catch {
        setChainId(null)
      }
    }
    provider.on?.('accountsChanged', onAccounts)
    provider.on?.('chainChanged', onChain)
    return () => {
      live = false
      provider.removeListener?.('accountsChanged', onAccounts)
      provider.removeListener?.('chainChanged', onChain)
    }
  }, [provider])

  const connect = useCallback(() => {
    if (!provider) return
    setConnecting(true)
    setError(null)
    void requestAccounts(provider)
      .then((accounts) => setAddress(accounts[0]?.toLowerCase() ?? null))
      .catch((err: unknown) => {
        // Declining is a decision, not a failure, and it gets no error banner.
        if (!isUserRejection(err)) {
          setError(err instanceof Error ? err.message : 'The wallet did not connect.')
        }
      })
      .finally(() => setConnecting(false))
  }, [provider])

  const requestChain = useCallback(
    async (target: number) => {
      if (!provider) return false
      const moved = await switchChain(provider, target)
      if (moved) setChainId(await walletChainId(provider))
      return moved
    },
    [provider],
  )

  return { address, chainId, available: provider !== null, connecting, error, connect, requestChain }
}
