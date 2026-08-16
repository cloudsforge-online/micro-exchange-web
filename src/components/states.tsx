/**
 * The states a panel on this surface can be in, as visibly different things.
 *
 * Four, and each one is a different sentence a reader has to be told:
 *
 *   LOADING       — the chain has not answered yet. Waiting is the correct action.
 *   EMPTY         — it answered, with nothing. NOTHING IS WRONG. On 2026-08-16 chain 7411 holds
 *                   exactly one pair, seeded by the estate, and neither network in this estate has
 *                   real users. So an `Empty` here is written as a cold start with something to do,
 *                   never as an absence to apologise for.
 *   FAILED        — the read did not come back. Retrying may help.
 *   NO EXCHANGE   — the chain answered and it is not a chain the exchange is deployed on. This is
 *                   the state pool-web did not have and paid for (micro-org#406): a page built to
 *                   explain a deliberate absence rendered it as an outage, because nothing told it
 *                   the difference between "no answer" and "correct answer, nothing here".
 *
 * ── THERE IS NO REQUEST ID ON `Failed`, AND THAT IS NOT AN OMISSION ───────────────────────────
 *
 * Every other console in this estate prints `x-request-id` because a CloudsForge service put it
 * there and a CloudsForge log line can be found with it. A public JSON-RPC node issues no such
 * thing, and inventing one would offer a reader a reference number that no support conversation
 * could ever resolve. What is offered instead is the one thing that IS actionable from a browser:
 * the read again, and the address of the contract it was asking about.
 *
 * ── NOTHING HERE PRINTS AN EXCEPTION ──────────────────────────────────────────────────────────
 *
 * `lib/rpc.ts` explains at length why a caught error from `fetch` is never rendered in this estate:
 * it carries the request URL, and that is how a credential has already leaked twice. The copy here
 * is fixed text chosen by the caller. There is deliberately no `detail` prop for a caught message
 * to arrive through.
 */
import type { ReactNode } from 'react'

// Every optional prop is spelled `?: T | undefined`. Under `exactOptionalPropertyTypes` those are
// two different types, and only the second accepts the `value ?? undefined` a caller writes when it
// may or may not have something to pass.
export function Loading({ label = 'Reading the chain' }: { label?: string | undefined }) {
  return (
    <div className="xc-state xc-state--loading" role="status" aria-live="polite">
      <span className="xc-spinner" aria-hidden="true" />
      <p className="xc-state__title">{label}</p>
    </div>
  )
}

export function Empty({
  title,
  hint,
  action,
}: {
  /**
   * What was asked, and that the answer was nothing. "No data" describes the screen rather than the
   * answer, and on a factory with one pair in it the screen is going to say it for a while.
   */
  title: string
  hint?: string | undefined
  action?: ReactNode | undefined
}) {
  return (
    <div className="xc-state xc-state--empty" role="status">
      <span className="xc-state__icon" aria-hidden="true">
        ◇
      </span>
      <p className="xc-state__title">{title}</p>
      {hint && <p className="xc-state__hint">{hint}</p>}
      {action && <div className="xc-state__action">{action}</div>}
    </div>
  )
}

/**
 * A read that did not come back.
 *
 * `title` says which read, because on this surface several are in flight at once and "something
 * failed" is not an actionable sentence when the reserves rendered and the quote did not.
 */
export function Failed({
  title = 'The chain did not answer',
  hint = 'The public node did not return this read. It may be a moment behind, or briefly ' +
    'unreachable. Nothing was sent and nothing was signed.',
  onRetry,
}: {
  title?: string | undefined
  hint?: string | undefined
  onRetry?: (() => void) | undefined
}) {
  return (
    <div className="xc-state xc-state--failed" role="alert">
      <span className="xc-state__icon" aria-hidden="true">
        ■
      </span>
      <p className="xc-state__title">{title}</p>
      <p className="xc-state__hint">{hint}</p>
      {onRetry && (
        <div className="xc-state__action">
          <button type="button" className="cf-btn" onClick={onRetry}>
            Read again
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The chain answered, and there is no exchange on it.
 *
 * A TRUE SENTENCE, NOT AN ERROR. `lib/dex.ts` holds one deployment and says why it holds one: a
 * speculative row for a chain nothing has been deployed to would render a swap form pointed at
 * addresses with no code behind them, and the first person to press the button would sign a
 * transaction into empty space. So the honest rendering of "this network does not run Forge
 * Exchange" is this panel, and the alternative — a form that quotes nothing — is the defect.
 */
export function NoExchange({ chainId }: { chainId: number | null }) {
  return (
    <div className="xc-state xc-state--absent" role="status">
      <span className="xc-state__icon" aria-hidden="true">
        ⌀
      </span>
      <p className="xc-state__title">Forge Exchange is not deployed on this network</p>
      <p className="xc-state__hint">
        The node answered{chainId === null ? '' : <> for chain {chainId}</>}, and there are no
        exchange contracts on it. Switch to Forge Network above to see the live pools. Nothing here
        is broken — the exchange simply is not there yet.
      </p>
    </div>
  )
}

/**
 * There is no chain endpoint to read at all.
 *
 * Distinct from `Failed` because it is not transient and retrying cannot fix it: the page is being
 * served from an address the surface registry does not know, so the RPC hostname composed from it
 * points somewhere that is not a CloudsForge node. `lib/hosts.ts` argues why that matters more on
 * this surface than on any other.
 */
export function NoEndpoint() {
  return (
    <div className="xc-state xc-state--absent" role="alert">
      <span className="xc-state__icon" aria-hidden="true">
        ⌀
      </span>
      <p className="xc-state__title">There is no chain endpoint for this address</p>
      <p className="xc-state__hint">
        This page is being served from a hostname the surface registry does not know, so it cannot
        work out which node to read. Every number on this surface comes from a chain; without one
        there is nothing honest to show.
      </p>
    </div>
  )
}
