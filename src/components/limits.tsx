/**
 * The two limits a reader sets before signing: how far the price may move, and how long the
 * transaction may wait.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * BOTH OF THESE ARE REFUSALS, AND THEY ARE WORDED AS REFUSALS.
 *
 * A slippage tolerance is not a fee, a budget or a preference about execution quality. It is the
 * point past which the reader would rather the transaction FAILED than filled — the whole mechanism
 * is a `require` in the router that reverts. Every frontend that labels it "max slippage" beside a
 * percentage teaches people it is a cost they are paying, and then those people set it to 50% to
 * make a stubborn transaction go through, which is how a sandwich attack gets its budget.
 *
 * A deadline is the same shape: after it, the transaction must not execute at all. Sending
 * `type(uint256).max` — which several well-known interfaces do — is not a generous deadline, it is
 * no deadline, and a transaction that sat in a mempool for an hour and then filled against a price
 * from an hour ago is exactly what the argument exists to prevent.
 *
 * So: fixed choices, no free-text box, and the hint under each legend says what happens when the
 * limit is hit rather than what the number is called.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFAULTS ARE ARGUED, NOT INHERITED ───────────────────────────────────────────────────
 *
 * 0.5% and twenty minutes. On a chain with one or two markets and no meaningful mempool
 * competition, 0.1% is achievable and is offered first; 0.5% is the default because a pool this
 * small moves on a single ordinary trade and a reader whose deposit reverts twice will raise the
 * number themselves, past where they would have stopped if the default had been sane. 1% is the
 * ceiling this surface offers. There is no "auto", because an automatic tolerance is a number
 * chosen for somebody without telling them what it is.
 */
import { DEADLINE_CHOICES } from '../lib/wallet.ts'

/** The tolerances offered, in basis points. Three, because a free-text field invites 50%. */
export const TOLERANCES: readonly { readonly bps: number; readonly label: string }[] = [
  { bps: 10, label: '0.1%' },
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
]

/** The default tolerance, named rather than reached for by index at four call sites. */
export const DEFAULT_TOLERANCE_BPS = 50

/** The default deadline, in minutes. Equals `DEADLINE_SECONDS` in `lib/wallet.ts`. */
export const DEFAULT_DEADLINE_MINUTES = 20

export function Limits({
  toleranceBps,
  onTolerance,
  deadlineMinutes,
  onDeadline,
  /**
   * What the tolerance is protecting, in the reader's own terms — "how much less you may receive",
   * "how little of each token you may end up depositing". The mechanism is identical across the
   * three flows and the consequence is not, so the sentence is the caller's.
   */
  toleranceHint,
  /** A distinguishing suffix for the radio groups' `name`, so two of these can share a page. */
  group,
}: {
  readonly toleranceBps: number
  readonly onTolerance: (bps: number) => void
  readonly deadlineMinutes: number
  readonly onDeadline: (minutes: number) => void
  readonly toleranceHint: string
  readonly group: string
}) {
  return (
    <div className="xc-limits">
      <fieldset className="xc-tolerance">
        <legend className="xc-tolerance__legend">
          Slippage tolerance
          <span className="xc-tolerance__hint">{toleranceHint}</span>
        </legend>
        <span className="xc-tolerance__opts">
          {TOLERANCES.map((option) => (
            <label key={option.bps} className="xc-tolerance__opt">
              <input
                type="radio"
                name={`tolerance-${group}`}
                value={option.bps}
                checked={toleranceBps === option.bps}
                onChange={() => onTolerance(option.bps)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </span>
      </fieldset>

      <fieldset className="xc-tolerance">
        <legend className="xc-tolerance__legend">
          Deadline
          <span className="xc-tolerance__hint">
            If this has not been mined within that long, it must not execute at all. A transaction
            that waits in a mempool and then fills against an old price is what this prevents.
          </span>
        </legend>
        <span className="xc-tolerance__opts">
          {DEADLINE_CHOICES.map((option) => (
            <label key={option.minutes} className="xc-tolerance__opt">
              <input
                type="radio"
                name={`deadline-${group}`}
                value={option.minutes}
                checked={deadlineMinutes === option.minutes}
                onChange={() => onDeadline(option.minutes)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </span>
      </fieldset>
    </div>
  )
}
