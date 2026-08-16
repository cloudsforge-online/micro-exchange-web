/**
 * Numbers and phrases, formatted in one place.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY AMOUNT ON THIS SURFACE IS A `bigint` UNTIL THE MOMENT IT BECOMES A STRING.
 *
 * A token balance is an integer of up to 78 digits and `Number` holds 15 of them exactly. So the
 * conversion happens HERE and nowhere else, at the last possible point, and there is deliberately
 * no helper in this file that takes a `number` and an amount of decimals — a signature like that is
 * an invitation to have already lost the money before calling it.
 *
 * The one exception is `curvePoints` in `lib/dex.ts`, which converts wei to floats because it is
 * feeding an SVG and an SVG coordinate is a float. That conversion is a PICTURE and it is labelled
 * as one; nothing a reader acts on comes out of it.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * A wei-style integer with its decimal point, at a chosen precision.
 *
 * ── THE ROUNDING IS TOWARD ZERO, ALWAYS, AND THAT IS A DECISION ABOUT MONEY ──────────────────
 *
 * Truncation rather than rounding. A balance of 0.9999 EMBER displayed as "1.0000" is a reader
 * who tries to swap 1 and is told they have insufficient funds, which reads as a bug in the page
 * rather than as a rounding convention. Down is the direction that never overstates what somebody
 * has.
 *
 * `significant` beyond `decimals` is not an error, it just has nothing to show — which is what the
 * padStart handles.
 */
export function formatUnits(value: bigint, decimals: number, precision = 6): string {
  const negative = value < 0n
  const digits = (negative ? -value : value).toString()
  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const fraction = padded.slice(padded.length - decimals)
  const shown = precision <= 0 ? '' : fraction.slice(0, precision).replace(/0+$/, '')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${shown ? `.${shown}` : ''}`
}

/**
 * A decimal string the reader typed, as an integer in the token's smallest unit.
 *
 * Returns **null** for anything that is not a plain non-negative decimal, including the empty
 * string, `1e18`, `-1` and `1.2.3`. Null is rendered as "nothing to quote" rather than as zero:
 * a swap form that silently treats a typo as 0 is a form that shows a quote of nothing and lets
 * the reader conclude the pool is empty.
 *
 * MORE DECIMAL PLACES THAN THE TOKEN HAS IS ALSO NULL, deliberately, rather than truncated. The
 * reader typed a number; a UI that quietly drops digits off the end of it is a UI that swaps a
 * different amount from the one on the screen.
 */
export function parseUnits(text: string, decimals: number): bigint | null {
  const trimmed = text.trim()
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null
  const [whole = '', fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) return null
  return BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0') || '0'.repeat(decimals)}`)
}

/**
 * Basis points as a percentage, for price impact and tolerance.
 *
 * Two decimal places below 1%, one above, because the interesting range for impact is the tenths
 * and the interesting range for a tolerance is whole numbers. Never rounds a non-zero impact to
 * "0.00%" — anything below a hundredth of a percent renders as "<0.01%", because a reader shown a
 * flat zero concludes the fee is zero too.
 */
export function formatBps(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps)) return '—'
  if (bps === 0) return '0%'
  if (bps < 1) return '<0.01%'
  const percent = bps / 100
  return `${percent < 1 ? percent.toFixed(2) : percent.toFixed(percent < 10 ? 2 : 1)}%`
}

/**
 * A price, as one token per one of the other.
 *
 * Computed in fixed point at 18 places rather than by dividing two floats, because the two reserves
 * routinely differ by more than 15 orders of magnitude — a pool with 25,000 EMBER against 4,950,000
 * of an 18-decimal token divides two numbers whose ratio a double cannot hold without loss in the
 * digits that are on screen.
 *
 * Null when either side is zero: an empty pool has no price, and a page that renders `0` or `∞`
 * for one has made an arithmetic statement about a market that does not exist.
 */
export function formatPrice(
  numerator: bigint,
  numeratorDecimals: number,
  denominator: bigint,
  denominatorDecimals: number,
): string | null {
  if (numerator <= 0n || denominator <= 0n) return null
  const scale = 10n ** 18n
  // Scale the ratio into 18 fixed-point places, correcting for the two tokens' own decimals so the
  // answer is in whole tokens per whole token rather than in smallest-unit per smallest-unit.
  const scaled =
    (numerator * scale * 10n ** BigInt(denominatorDecimals)) /
    (denominator * 10n ** BigInt(numeratorDecimals))
  return formatUnits(scaled, 18, significantPrecision(scaled))
}

/** How many decimal places a fixed-point-18 price should show: enough to be a number, never more. */
function significantPrecision(scaled: bigint): number {
  const whole = scaled / 10n ** 18n
  if (whole >= 1000n) return 2
  if (whole >= 1n) return 4
  return 8
}

/** A whole number with thousands separators, in the page's locale-independent form. */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-GB') : '—'
}

/**
 * A long hash or address, shortened for a table.
 *
 * NEVER for a link's own text content and never for anything a reader is expected to transcribe:
 * the middle of an address is where a substitution attack hides, and a UI that only ever shows the
 * ends has trained its readers not to look. `contracts.tsx` prints every address in full for that
 * reason, and this is for the places where the full string would break the layout and the full
 * string is one click away.
 */
export function shortAddress(address: string): string {
  return address.length <= 20 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`
}

/**
 * A block height, with separators.
 *
 * Separate from `formatCount` on purpose: a height is not a quantity of anything and reads wrong
 * with a decimal point ever attached, so it takes an integer and says so in its name.
 */
export function formatBlock(height: number | null): string {
  return height === null ? '—' : `#${formatCount(height)}`
}

/* ── the sentences ─────────────────────────────────────────────────────────────────────────────
 *
 * Declared once for the reason the numbers are: this surface makes a small number of claims it must
 * make identically everywhere, and six paraphrases of "we do not hold your coins" is how one of
 * them softens into a hedge and then into nothing.
 */

/** THE SENTENCE. Rendered in the footer and again wherever a signature is asked for. */
export const NOT_CUSTODIED =
  'CloudsForge never holds your coins. Every swap is a transaction your own wallet signs, sent to ' +
  'the router contract, which sends the proceeds to your own address.'

/** What a reader is agreeing to when they press the button, in the order it matters. */
export const SWAP_TERMS: readonly { readonly what: string; readonly detail: string }[] = [
  {
    what: 'The price moves as you trade',
    detail:
      'This is a constant-product pool, not an order book. Your own trade changes the price before ' +
      'it fills, and the bigger it is relative to the reserves, the further. That is the price ' +
      'impact shown beside every quote, and it is certain — it is not an estimate of what somebody ' +
      'else might do.',
  },
  {
    what: 'The fee is 0.3%, taken from what you put in',
    detail:
      'It stays in the pool and belongs to whoever supplied the liquidity. There is no CloudsForge ' +
      'fee on top: the factory’s fee switch is off, and the page reads that off the chain rather ' +
      'than claiming it.',
  },
  {
    what: 'Nothing here is reversible',
    detail:
      'A swap is a transaction on a public chain. Once it is mined there is no support desk that ' +
      'can undo it, and CloudsForge has no ability to move anything back.',
  },
]
