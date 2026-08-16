/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE SIGNATURE ELEMENT OF THIS SURFACE: THE INVARIANT, DRAWN FROM THE REAL RESERVES.
 *
 * Every exchange frontend in existence draws a price CHART — a line of what the price used to be,
 * over time. That chart is the wrong picture for this machine, and drawing it here would have been
 * the templated answer. A constant-product pool has no price history of its own; it has a curve,
 * `x·y = k`, and a position on it. The price is the slope at that position, and it is not a fact
 * about the past at all — it is a fact about where the reserves are RIGHT NOW.
 *
 * So this is the curve, plotted from the two reserves this page just read, with the reader's own
 * typed amount drawn as a SLIDE ALONG IT: from where the pool is now to where their trade would
 * leave it. The gap between the chord and the tangent is the price impact — not a number in a
 * tooltip that has to be believed, but the visible bend of the line they are about to travel.
 *
 * That is the whole argument for this element: on this machine, price impact is geometry. A reader
 * who has never heard the phrase can see that a small trade barely moves along the curve and a
 * large one climbs the steep part, and can see it before they press anything.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────────────────────────
 *
 * It does not animate on load. A curve that draws itself is a decoration that delays the one fact
 * the reader came for, and the fact is already on screen as numbers beside it. The only motion is
 * the marker moving when the amount changes, which is feedback rather than ornament, and it is
 * suppressed under `prefers-reduced-motion` by `src/styles.css`.
 *
 * It does not invent an axis scale that flatters the pool. The window comes from `curvePoints()`,
 * which is `[reserveIn/8, reserveIn·4]` and is argued for there. A window fitted to the trade would
 * make every trade look identical, which is the opposite of what this is for.
 *
 * ── ACCESSIBILITY: THE PICTURE IS NEVER THE ONLY COPY OF THE FACT ────────────────────────────
 *
 * The SVG is `role="img"` with a written label naming the two reserves and, when there is a trade,
 * where it lands. Doc 22 §2.4.3 addresses elements by role and name, so the label is also what the
 * tests assert against — which keeps it accurate, because a stale label fails the build rather than
 * quietly misdescribing a chart to the readers who depend on it most.
 */
import { useId } from 'react'
import { curvePoints } from '../lib/dex.ts'
import { formatUnits } from '../lib/format.ts'

/** The plot area, in user units. The SVG scales; these decide the aspect ratio only. */
const W = 320
const H = 200
const PAD = 14

export interface CurveProps {
  /** The reserve of the token going IN, in wei. */
  readonly reserveIn: bigint
  /** The reserve of the token coming OUT, in wei. */
  readonly reserveOut: bigint
  readonly decimalsIn: number
  readonly decimalsOut: number
  readonly symbolIn: string
  readonly symbolOut: string
  /** The trade, when the reader has typed one. Both in wei. */
  readonly amountIn?: bigint | undefined
  readonly amountOut?: bigint | undefined
}

export function InvariantCurve({
  reserveIn,
  reserveOut,
  decimalsIn,
  decimalsOut,
  symbolIn,
  symbolOut,
  amountIn,
  amountOut,
}: CurveProps) {
  const gradientId = useId()
  const points = curvePoints(reserveIn, reserveOut)
  if (points.length === 0) {
    return (
      <p className="xc-curve__none">
        This pool has no reserves on one side, so it has no curve and no price.
      </p>
    )
  }

  // The window, from the sampled points rather than recomputed, so the plot and the samples cannot
  // disagree about what is on screen.
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)

  const px = (x: number): number => PAD + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD * 2)
  const py = (y: number): number => H - PAD - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD * 2)

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x)} ${py(p.y)}`).join(' ')

  const now = { x: Number(reserveIn), y: Number(reserveOut) }
  const traded =
    amountIn !== undefined && amountIn > 0n && amountOut !== undefined && amountOut > 0n
      ? { x: Number(reserveIn + amountIn), y: Number(reserveOut - amountOut) }
      : null

  // The tangent at `now` is the price with no trade: slope `-y/x`. Drawn to the same x as the
  // trade lands on, so the vertical gap between the two end points IS the price impact, at scale.
  const tangentTo =
    traded === null ? null : { x: traded.x, y: now.y - (now.y / now.x) * (traded.x - now.x) }

  const inLabel = `${formatUnits(reserveIn, decimalsIn, 4)} ${symbolIn}`
  const outLabel = `${formatUnits(reserveOut, decimalsOut, 4)} ${symbolOut}`
  const description =
    traded === null
      ? `The pool holds ${inLabel} against ${outLabel}. The curve is every pair of reserves with the same product.`
      : `The pool holds ${inLabel} against ${outLabel}. Adding ${formatUnits(
          amountIn as bigint,
          decimalsIn,
          4,
        )} ${symbolIn} slides it along the curve and takes out ${formatUnits(
          amountOut as bigint,
          decimalsOut,
          4,
        )} ${symbolOut}.`

  return (
    <figure className="xc-curve">
      <svg
        className="xc-curve__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={description}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="xc-curve__wash-top" />
            <stop offset="100%" className="xc-curve__wash-bottom" />
          </linearGradient>
        </defs>

        {/* The axes are unlabelled hairlines on purpose: the numbers are beside the plot in
            text, and a chart with tick labels invites reading a value off it, which on a
            hyperbola over four orders of magnitude is exactly the wrong habit. */}
        <line className="xc-curve__axis" x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
        <line className="xc-curve__axis" x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} />

        <path className="xc-curve__fill" d={`${path} L${px(xMax)} ${H - PAD} L${px(xMin)} ${H - PAD} Z`} fill={`url(#${gradientId})`} />
        <path className="xc-curve__line" d={path} />

        {tangentTo !== null && traded !== null && (
          <>
            {/* The no-trade price, as a straight line. Where the curve falls below it is the
                fee and the impact together — the reason the fill is worse than the quote. */}
            <line
              className="xc-curve__tangent"
              x1={px(now.x)}
              y1={py(now.y)}
              x2={px(tangentTo.x)}
              y2={py(Math.max(tangentTo.y, yMin))}
            />
            <line
              className="xc-curve__slide"
              x1={px(now.x)}
              y1={py(now.y)}
              x2={px(traded.x)}
              y2={py(traded.y)}
            />
            <circle className="xc-curve__after" cx={px(traded.x)} cy={py(traded.y)} r={4} />
          </>
        )}

        <circle className="xc-curve__now" cx={px(now.x)} cy={py(now.y)} r={4.5} />
      </svg>
      <figcaption className="xc-curve__caption">
        <span className="xc-curve__axis-label">
          {symbolIn} in the pool <span aria-hidden="true">→</span>
        </span>
        <span className="xc-curve__axis-label xc-curve__axis-label--y">
          <span aria-hidden="true">↑</span> {symbolOut} in the pool
        </span>
      </figcaption>
    </figure>
  )
}
