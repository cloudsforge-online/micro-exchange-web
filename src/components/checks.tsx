/**
 * A check, and the two sides of it — the vocabulary this surface uses to prove things.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE VERDICT IS A WORD, NOT A COLOUR AND NOT A SYMBOL.
 *
 * A tick renders identically whether the page checked anything or decided to draw one, and a reader
 * who is here because they are suspicious is owed a sentence. Every verdict below is therefore a
 * phrase, the colour is only ever an emphasis on top of it, and `unknown` is a first-class outcome
 * with its own word — because "the node did not answer" and "the answer was bad" are different
 * findings and a two-way ternary renders the first as the second.
 *
 * ── WHY THIS IS ITS OWN MODULE ───────────────────────────────────────────────────────────────
 *
 * It started inside `pages/contracts.tsx`, which is where the idiom was invented. `pages/receipts.tsx`
 * needs the same thing, and a second copy would drift: one of them would gain a fourth verdict, or
 * start rendering a tick for the compact case, and the surface would be making the same claim in two
 * voices. The claims these two pages make are the ones a reader is least willing to take twice.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { ReactNode } from 'react'
import type { CloudsForgeHosts } from '@cloudsforge/ui'
import { explorerAddressUrl } from '../lib/hosts.ts'

/**
 * Every outcome a check on this surface may have.
 *
 * `match`/`differ` compare two strings. `off`/`on` report a switch. `covered`/`short` report an
 * inequality between two amounts, and they are separate from `match` because a reserve that exceeds
 * supply is a PASS while two addresses that differ by any amount is a fail — one word covering both
 * would eventually be used for the wrong one.
 */
export type Verdict =
  | 'match'
  | 'differ'
  | 'unknown'
  | 'off'
  | 'on'
  | 'covered'
  | 'short'
  | 'fresh'
  | 'stale'
  | 'settled'
  | 'owing'
  | 'none'

export const VERDICT_WORD: Readonly<Record<Verdict, string>> = {
  match: 'They match',
  differ: 'They differ',
  unknown: 'Not answered',
  off: 'Off',
  on: 'On',
  covered: 'Fully covered',
  short: 'Short',
  fresh: 'Fresh',
  stale: 'Stale',
  settled: 'All settled',
  owing: 'Unpaid',
  none: 'Nothing to check',
}

/**
 * The verdicts that mean something is wrong, in one place.
 *
 * A SET RATHER THAN A CONDITION AT EACH CALL SITE. `verdict === 'differ' || verdict === 'on'` was
 * fine while there were five verdicts and one page; with twelve and two, the check that forgets to
 * list `short` is a page that renders an uncovered receipt in the same ink as a covered one.
 */
const BAD: ReadonlySet<Verdict> = new Set<Verdict>(['differ', 'on', 'short', 'stale', 'owing'])

/** One check: the question, the verdict, the values it was reached from, and what it would mean. */
export function Check({
  n,
  question,
  verdict,
  why,
  children,
}: {
  readonly n: number
  readonly question: string
  readonly verdict: Verdict
  readonly why: string
  readonly children: ReactNode
}) {
  const bad = BAD.has(verdict)
  const unknown = verdict === 'unknown' || verdict === 'none'
  return (
    <li className="xc-check">
      <div className="xc-check__head">
        {/* The numbering is real: these are ordered by what a later one depends on. Check 2 is
            meaningless if check 1 failed, and check 3 assumes both. */}
        <span className="xc-check__n cf-num" aria-hidden="true">
          {n}
        </span>
        <h3 className="xc-check__question">{question}</h3>
        <span
          className={`xc-check__verdict${bad ? ' xc-check__verdict--bad' : unknown ? ' xc-check__verdict--unknown' : ''}`}
        >
          {VERDICT_WORD[verdict]}
        </span>
      </div>
      <div className="xc-check__body">{children}</div>
      <p className="xc-check__why">{why}</p>
    </li>
  )
}

/**
 * One side of a comparison: what it is called, and what it said.
 *
 * `null` renders "no answer" rather than an empty cell, because an empty cell beside a full one
 * reads as a zero, an empty string, or a rendering bug — three readings, none of them the true one.
 */
export function Side({
  label,
  value,
  link,
}: {
  readonly label: string
  readonly value: string | null
  readonly link?: CloudsForgeHosts
}) {
  return (
    <p className="xc-side">
      <span className="xc-side__label">{label}</span>
      {value === null ? (
        <span className="xc-side__none">no answer</span>
      ) : link !== undefined ? (
        <a
          className="cf-num xc-side__value"
          href={explorerAddressUrl(link, value)}
          target="_blank"
          rel="noreferrer"
        >
          {value}
        </a>
      ) : (
        <span className="cf-num xc-side__value">{value}</span>
      )}
    </p>
  )
}
