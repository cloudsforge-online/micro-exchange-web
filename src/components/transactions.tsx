/**
 * The transactions this page sent, and what became of them.
 *
 * ── FOUR SENTENCES, NOT ONE SENTENCE WITH A COLOUR ────────────────────────────────────────────
 *
 * Each state gets its own words. "Sent" is not a verdict, "mined" is, "reverted" is a different
 * verdict that costs the same gas, and "we stopped asking" is not a verdict at all. A UI that
 * distinguished them only by a green or red dot would be one that says nothing to a reader using a
 * screen reader and very little to one glancing at it — so the colour is decoration and the text
 * carries the meaning.
 *
 * `role="alert"` on a revert and `role="status"` on everything else, because a revert is the one
 * outcome a reader has to be interrupted for: they believe the thing worked. The list is newest
 * first and each entry can be dismissed, which removes it from this page and does nothing at all to
 * the chain — the button says so.
 *
 * The explorer link is present in every state including pending, because it is the only thing on
 * this page that outlives it. `lib/tx.ts` deliberately persists nothing.
 */
import type { CloudsForgeHosts } from '@cloudsforge/ui'
import { shortAddress } from '../lib/format.ts'
import { explorerTxUrl } from '../lib/hosts.ts'
import type { TrackedTx, TxStatus } from '../lib/tx.ts'

/**
 * The modifier for each state, spelled out.
 *
 * `xc-tx--${tx.status}` would be shorter and would build four class names that nothing can see:
 * `test/tokens.test.ts` reads the source for class names and would find only `xc-tx--`, so a
 * missing rule for one state would ship as an entry with no coloured edge and no failing test.
 * Written out, all four are checked against the stylesheet.
 */
const MODIFIER: Readonly<Record<TxStatus, string>> = {
  pending: 'xc-tx--pending',
  mined: 'xc-tx--mined',
  reverted: 'xc-tx--reverted',
  lost: 'xc-tx--lost',
}

export function Transactions({
  transactions,
  estate,
  onForget,
}: {
  readonly transactions: readonly TrackedTx[]
  readonly estate: CloudsForgeHosts
  readonly onForget: (hash: string) => void
}) {
  if (transactions.length === 0) return null
  return (
    <section className="xc-txs" aria-label="Transactions this page sent">
      <ul className="xc-txs__list">
        {transactions.map((tx) => (
          <li
            className={`xc-tx ${MODIFIER[tx.status]}`}
            key={tx.hash}
            role={tx.status === 'reverted' ? 'alert' : 'status'}
          >
            <span className="xc-tx__what">{tx.what}</span>
            <span className="xc-tx__state">{sentence(tx)}</span>
            <a
              className="xc-tx__link cf-num"
              href={explorerTxUrl(estate, tx.hash)}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddress(tx.hash)}
            </a>
            <button
              type="button"
              className="xc-tx__forget"
              onClick={() => onForget(tx.hash)}
              aria-label={`Dismiss ${tx.what.toLowerCase()} ${shortAddress(tx.hash)}`}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      <p className="xc-txs__note">
        Dismissing an entry removes it from this page. It does not cancel anything: a transaction the
        chain has accepted cannot be recalled, and this list is lost on reload either way.
      </p>
    </section>
  )
}

/**
 * The one sentence for a state.
 *
 * "Reverted" is spelled out rather than named: `execution reverted` means nothing to somebody who
 * has just watched gas leave their wallet, and the two ordinary causes on this surface — a
 * minimum that the price moved past, and a deadline that expired — are worth naming where the
 * reader is looking.
 */
function sentence(tx: TrackedTx): string {
  if (tx.status === 'pending') return 'sent, waiting for a block'
  if (tx.status === 'mined') {
    return tx.blockNumber === null ? 'confirmed' : `confirmed in block ${tx.blockNumber}`
  }
  if (tx.status === 'reverted') {
    return 'was mined and reverted — the gas was spent and nothing moved. Usually the price passed the minimum you set, or the deadline expired.'
  }
  return 'has no receipt yet and this page has stopped asking. Check the explorer, or your wallet, for what became of it.'
}
