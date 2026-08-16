/**
 * The formatters, and the three of them that are load-bearing rather than cosmetic.
 *
 * `formatUnits` must never touch `Number`, `parseUnits` must never turn a typo into a zero, and
 * `formatPrice` must never divide two floats. Each of those is a way of showing a reader a figure
 * that is wrong in the direction that costs them money, which is the failure mode this whole
 * repository is organised around — and on this surface the figure is not a report of something that
 * already happened, it is the number they are about to sign for.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatBlock,
  formatBps,
  formatCount,
  formatPrice,
  formatUnits,
  NOT_CUSTODIED,
  parseUnits,
  shortAddress,
  SWAP_TERMS,
} from '../src/lib/format.ts'

test('AN AMOUNT IS RENDERED FROM THE INTEGER AND NEVER THROUGH A JAVASCRIPT NUMBER', () => {
  // A token balance is an integer of up to 78 digits and a double holds 15 of them exactly. The
  // value below already exceeds that, and it is the ordinary size of a balance at 18 decimals — not
  // an edge case somebody has to go looking for.
  const huge = 90071992547409931234567890n
  assert.equal(formatUnits(huge, 18), '90,071,992.547409')
  assert.notEqual(
    BigInt(Number(huge)),
    huge,
    'the fixture must actually exceed what a double holds, or this test proves nothing',
  )

  assert.equal(formatUnits(10n ** 18n, 18), '1')
  assert.equal(formatUnits(1234567890123456789n, 18), '1.234567')
  assert.equal(formatUnits(0n, 18), '0')
  assert.equal(formatUnits(-1250000000n, 8), '-12.5')
  assert.equal(formatUnits(100n, 0), '100')
  // Precision beyond the token's own decimals has nothing to show rather than something wrong.
  assert.equal(formatUnits(5n, 2, 6), '0.05')
  // Zero precision drops the point entirely; it does not leave a dangling one.
  assert.equal(formatUnits(1500n, 2, 0), '15')
})

test('THE ROUNDING IS TOWARD ZERO, ALWAYS, AND THAT IS A DECISION ABOUT MONEY', () => {
  // 0.9999 EMBER shown as "1.0000" is a reader who tries to swap 1 and is told they have
  // insufficient funds — which reads as a bug in the page rather than as a rounding convention.
  // Down is the direction that never overstates what somebody has.
  assert.equal(formatUnits(999_900_000_000_000_000n, 18, 2), '0.99')
  assert.equal(formatUnits(-999_900_000_000_000_000n, 18, 2), '-0.99')
  // The same rule taken to its end: dust below the shown precision reads as 0, because the reader
  // has, for every purpose this page can act on, none of it.
  assert.equal(formatUnits(1n, 18), '0')
})

test('a typed amount that is not a plain decimal is NULL, and null is not zero', () => {
  // A swap form that silently treats a typo as 0 shows a quote of nothing and lets the reader
  // conclude the pool is empty. Every one of these is a shape a person or a paste actually produces.
  for (const bad of ['', '.', '-1', '1e18', '1.2.3', '0x10', 'abc', '1,5', '+1', 'Infinity']) {
    assert.equal(parseUnits(bad, 18), null, `${JSON.stringify(bad)} should not parse`)
  }
  // MORE PLACES THAN THE TOKEN HAS IS ALSO NULL, deliberately, rather than truncated. The reader
  // typed a number; a UI that quietly drops digits off the end of it swaps a different amount from
  // the one on the screen — and the digits it drops are the ones the reader added on purpose.
  assert.equal(parseUnits('0.0000001', 6), null)
  assert.equal(parseUnits('1.5', 0), null)

  assert.equal(parseUnits('1', 18), 10n ** 18n)
  assert.equal(parseUnits('1.5', 18), 1_500_000_000_000_000_000n)
  assert.equal(parseUnits('.5', 18), 500_000_000_000_000_000n)
  assert.equal(parseUnits(' 1.5 ', 18), 1_500_000_000_000_000_000n)
  // Zero is a VALID amount and must be distinguishable from a refusal to parse. `0n` is falsy, so
  // any caller that tests the result for truthiness rather than for null has this bug already.
  assert.equal(parseUnits('0', 18), 0n)
  assert.notEqual(parseUnits('0', 18), null)
})

test('a round trip through both directions keeps every digit', () => {
  // The two functions are each other's inverse for anything a reader can type, and the pair is what
  // the swap form uses: parse what was typed, quote in wei, format the answer back. A loss in
  // either direction shows up as a quote that does not match the amount above it.
  for (const text of ['1', '1.5', '0.000000000000000001', '123456789.123456789012345678']) {
    const parsed = parseUnits(text, 18)
    assert.notEqual(parsed, null, `${text} should parse`)
    assert.equal(formatUnits(parsed as bigint, 18, 18).replace(/,/g, ''), text)
  }
})

test('a fee or an impact never rounds down to a flat zero', () => {
  // A reader shown "0.00%" concludes the trade is free. Anything below a hundredth of a percent is
  // therefore rendered as a bound rather than as a number — and a genuine zero still says so.
  assert.equal(formatBps(0), '0%')
  assert.equal(formatBps(0.5), '<0.01%')
  assert.equal(formatBps(1), '0.01%')
  assert.equal(formatBps(30), '0.30%')
  assert.equal(formatBps(100), '1.00%')
  assert.equal(formatBps(250), '2.50%')
  // Above 10% the tenths are what matter and the hundredths are noise.
  assert.equal(formatBps(5000), '50.0%')
  // Unknown is a dash, not a zero: a quote that could not be computed has no impact rather than an
  // impact of nothing.
  assert.equal(formatBps(null), '—')
  assert.equal(formatBps(Number.NaN), '—')
})

test('A PRICE IS FIXED-POINT DIVISION, NOT TWO FLOATS, AND THE DECIMALS ARE CORRECTED', () => {
  // Five tokens of a 6-decimal stable against one of an 18-decimal token is five, and it is the
  // case that catches the mistake: without the decimals correction the same reserves quote a price
  // 10^12 out, which is not a rounding error, it is a different number.
  assert.equal(formatPrice(5_000_000n, 6, 10n ** 18n, 18), '5')
  assert.equal(formatPrice(2n * 10n ** 18n, 18, 10n ** 18n, 18), '2')

  // A third, exactly, to the eight places a sub-unit price shows. A double would agree here; the
  // point is that the arithmetic never left the integers.
  assert.equal(formatPrice(10n ** 18n, 18, 3n * 10n ** 18n, 18), '0.33333333')

  // The pool from the module's own docstring: 25,000 EMBER against 4,950,000 of an 18-decimal
  // token. The two reserves differ by more than 15 orders of magnitude from the answer, which is
  // where a double loses the digits that are on screen.
  assert.equal(formatPrice(25_000n * 10n ** 18n, 18, 4_950_000n * 10n ** 18n, 18), '0.0050505')

  // Precision follows magnitude: a four-figure price shows two places, because the eight a
  // sub-unit price needs would be false precision on a number nobody quotes that way.
  assert.equal(formatPrice(123_456n * 10n ** 18n, 18, 10n ** 18n, 18), '123,456')
})

test('AN EMPTY POOL HAS NO PRICE, AND THAT IS NULL RATHER THAN 0 OR ∞', () => {
  // A page that renders `0` or `∞` for an empty pool has made an arithmetic statement about a
  // market that does not exist. Null is what the caller renders as "no price yet".
  assert.equal(formatPrice(0n, 18, 10n ** 18n, 18), null)
  assert.equal(formatPrice(10n ** 18n, 18, 0n, 18), null)
  assert.equal(formatPrice(0n, 18, 0n, 18), null)
})

test('counts, heights and shortened addresses', () => {
  assert.equal(formatCount(2_912_004), '2,912,004')
  assert.equal(formatCount(0), '0')
  assert.equal(formatCount(Number.NaN), '—')

  // A height is not a quantity of anything, which is why it has a formatter of its own and a `#`.
  assert.equal(formatBlock(38_843), '#38,843')
  assert.equal(formatBlock(null), '—')

  const address = '0x8e41e0a5b3c2d1f09876543210fedcba01234567'
  const short = shortAddress(address)
  assert.equal(short, '0x8e41e0…234567')
  assert.ok(short.startsWith('0x8e41e0'), 'the leading bytes are what a reader recognises')
  assert.ok(short.endsWith('234567'))
  // Nothing short enough to show whole is ever abbreviated: an ellipsis on a string that fits is a
  // reader wondering what was hidden.
  assert.equal(shortAddress('EMBER'), 'EMBER')
})

test('THE SENTENCE IS PRESENT TENSE AND MAKES NO PROMISE ABOUT SAFETY', () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // The one claim this surface must make identically everywhere. Six paraphrases of "we do not
  // hold your coins" is how one of them softens into a hedge and then into nothing — and a hedged
  // version of THIS sentence is the difference between a description and a misrepresentation.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  const words = NOT_CUSTODIED.toLowerCase()
  assert.ok(words.includes('never holds your coins'))
  assert.ok(words.includes('your own wallet signs'))
  for (const forbidden of ['guarantee', 'safe', 'secure', 'insured', 'risk-free', 'protected']) {
    assert.ok(!words.includes(forbidden), `the standing statement must not say "${forbidden}"`)
  }
  // Custody is a fact about who holds a key. It is not a schedule, so nothing here may read as one.
  for (const forbidden of ['not yet', 'coming soon', 'will be', 'for now', 'currently']) {
    assert.ok(!words.includes(forbidden), `the standing statement must not say "${forbidden}"`)
  }
})

test('every term a reader agrees to says what happens, not what is absent', () => {
  // "No custody" tells a reader nothing. "Your own wallet signs every trade and the proceeds go to
  // your own address" tells them where their coins will be, which is the question they arrived
  // with. A one-sided list would be a disclaimer rather than a description.
  assert.equal(SWAP_TERMS.length, 3)
  for (const term of SWAP_TERMS) {
    assert.ok(term.detail.length > 80, `"${term.what}" states a term and does not explain it`)
    // Each heading is a clause about behaviour rather than a noun phrase, because the headings are
    // the only part of this most readers will read. No full stop: it is a label, not a paragraph,
    // and a stop at the end of one invites the next person to write two sentences in it.
    assert.match(term.what, /^[A-Z]/)
    assert.ok(!term.what.endsWith('.'), `"${term.what}" is a label and takes no full stop`)
  }
  const all = SWAP_TERMS.map((term) => `${term.what} ${term.detail}`).join(' ')
  // The fee is READ OFF THE CHAIN rather than claimed, and the copy has to say so — it is the one
  // number on this page that a deployment could change without anybody editing this repository.
  assert.ok(all.includes('0.3%'))
  assert.ok(all.includes('fee switch'))
  assert.ok(all.toLowerCase().includes('price impact'))
  assert.ok(all.toLowerCase().includes('reversible'))
})
