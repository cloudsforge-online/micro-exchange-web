/**
 * What happened to the transactions this page sent.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A PENDING TRANSACTION IS A STATE, AND FORGETTING IT IS A DEFECT.
 *
 * The pattern this file replaces is on every exchange frontend and was on this one: send, receive a
 * hash, print "sent" with a link to the explorer, and never mention it again. That UI cannot tell a
 * reader the one thing they want to know next — did it work — and it is actively misleading in the
 * case that matters most, a transaction that was MINED AND REVERTED. Gas was spent, the hash is
 * real, the explorer link works, and nothing moved. "Swap sent" is the wrong sentence for that and
 * it is the only sentence the old shape could say.
 *
 * So a transaction lives here from broadcast until the chain answers, in four states:
 *
 *   pending   — broadcast, no receipt yet. The normal state for a few blocks.
 *   mined     — a receipt with `status: 1`. It did what it said.
 *   reverted  — a receipt with `status: 0`. Mined, gas spent, nothing moved. Its own sentence.
 *   lost      — no receipt after `POLL_GIVE_UP_MS`. NOT a verdict: it means this page stopped
 *               asking, which is a fact about the page. It is dropped or replaced by the reader's
 *               own wallet, or the node is behind, and the explorer link is the way to find out.
 *
 * ── IT POLLS THE PUBLIC RPC, NOT THE WALLET ─────────────────────────────────────────────────
 *
 * `eth_getTransactionReceipt` through `lib/rpc.ts`, the same endpoint every other read on this
 * surface goes through, rather than through the injected provider. Two reasons. A wallet extension
 * proxies reads to whatever node the reader configured, which may be a different node from the one
 * the page's numbers came from — so a receipt from it could disagree with the reserves beside it.
 * And a reader whose wallet is on the wrong chain still gets an honest answer here, because this
 * endpoint is the chain the page is reading.
 *
 * ── NOTHING IS PERSISTED ─────────────────────────────────────────────────────────────────────
 *
 * No `localStorage`. A reload loses the list, and that is the correct trade: the authority on what
 * happened is the chain, the explorer link survives in the reader's own history, and a list of
 * transaction hashes written to disk by a page that never asked to keep them is a small privacy
 * decision made on somebody's behalf. `test/no-build-time-config.test.ts` is not the rule here, but
 * the instinct is the same one.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { transactionReceipt } from './rpc.ts'

/**
 * How often the chain is asked, and how long before this page stops asking.
 *
 * Three seconds is under Hearth's block time, so a transaction is generally reported within one
 * block of being mined without the endpoint being hammered. Ten minutes is the give-up: it is well
 * past the default deadline this surface encodes (`DEADLINE_SECONDS`, twenty minutes) being a
 * plausible wait, and a spinner that runs for an hour is a page pretending to know something.
 */
export const POLL_INTERVAL_MS = 3_000
export const POLL_GIVE_UP_MS = 10 * 60 * 1_000

export type TxStatus = 'pending' | 'mined' | 'reverted' | 'lost'

export interface TrackedTx {
  readonly hash: string
  /** What the reader pressed: "Deposit", "Withdrawal", "Approval", "Swap", "New pool". */
  readonly what: string
  readonly status: TxStatus
  /** The block it landed in, once there is a receipt. */
  readonly blockNumber: number | null
  /** When this page broadcast it, by the reader's own clock. Only used to time the give-up. */
  readonly sentAt: number
}

export interface TxTracker {
  /** Newest first, which is the order somebody reads a list of things they just did. */
  readonly transactions: readonly TrackedTx[]
  readonly pending: number
  /** Record a broadcast hash. Polling starts on the next tick. */
  track: (what: string, hash: string) => void
  /** Drop one from the list. The chain is unaffected; this is a dismissal, not a cancellation. */
  forget: (hash: string) => void
}

/**
 * Track transactions, and call `onSettled` each time one of them stops being pending.
 *
 * `onSettled` is how the balances on a page get re-read at the moment they actually changed, rather
 * than optimistically at broadcast — which is the other half of the same defect. A page that
 * subtracts the deposit from the displayed balance when the wallet returns a hash is a page that
 * lies for as long as the transaction takes, and keeps lying if it reverts.
 */
export function useTransactions(onSettled?: () => void): TxTracker {
  const [transactions, setTransactions] = useState<readonly TrackedTx[]>([])
  const settled = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    settled.current = onSettled
  }, [onSettled])

  const track = useCallback((what: string, hash: string) => {
    setTransactions((current) => {
      // A wallet that answers with a hash already in the list is a wallet that resubmitted the same
      // transaction; one entry is the truth about it.
      if (current.some((tx) => tx.hash === hash)) return current
      return [{ hash, what, status: 'pending', blockNumber: null, sentAt: Date.now() }, ...current]
    })
  }, [])

  const forget = useCallback((hash: string) => {
    setTransactions((current) => current.filter((tx) => tx.hash !== hash))
  }, [])

  useEffect(() => {
    const waiting = transactions.filter((tx) => tx.status === 'pending')
    if (waiting.length === 0) return
    let live = true

    const check = async () => {
      const answers = await Promise.all(
        waiting.map(async (tx) => ({ hash: tx.hash, receipt: await transactionReceipt(tx.hash) })),
      )
      if (!live) return
      const now = Date.now()
      let moved = false
      setTransactions((current) => {
        // The SAME array back when nothing changed, deliberately: this effect depends on
        // `transactions`, so a fresh array on every poll would re-run it forever and turn a
        // three-second poll into a busy loop.
        const next = current.map((tx): TrackedTx => {
          if (tx.status !== 'pending') return tx
          const answer = answers.find((a) => a.hash === tx.hash)
          if (answer === undefined) return tx
          if (answer.receipt !== null) {
            moved = true
            return { ...tx, status: answer.receipt.status, blockNumber: answer.receipt.blockNumber }
          }
          if (now - tx.sentAt >= POLL_GIVE_UP_MS) {
            moved = true
            return { ...tx, status: 'lost' }
          }
          return tx
        })
        return moved ? next : current
      })
      // Fired from here rather than from inside the updater, which React may run twice.
      if (answers.some((a) => a.receipt !== null)) settled.current?.()
    }

    void check()
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [transactions])

  return {
    transactions,
    pending: transactions.filter((tx) => tx.status === 'pending').length,
    track,
    forget,
  }
}
