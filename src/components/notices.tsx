/**
 * The two standing notices — the ones the shell renders above every page rather than leaving to a
 * page to remember.
 *
 * A notice earns a place here by being true on EVERY route and by being something a reader would
 * act differently for if they had not read it. Everything else belongs on the page it is about,
 * because a banner that is always there is a banner nobody reads by the third visit.
 */
import { NOT_CUSTODIED } from '../lib/format.ts'

/**
 * "You are not where you think you are."
 *
 * `lib/hosts.ts` argues why an unregistered placement matters more on this surface than on any
 * other: the chain endpoint is composed from the same apex every CloudsForge URL is, so a hostname
 * the registry cannot split is a page that will not read a chain at all. Saying so once, plainly,
 * is better than three panels each reporting an unreachable node.
 */
export function UnregisteredNotice() {
  return (
    <aside className="xc-notice xc-notice--warn" role="note">
      <p className="xc-notice__title">This is not a CloudsForge address</p>
      <p className="xc-notice__body">
        This page is being served from a hostname the surface registry does not know, so it cannot
        work out which chain node to read or which sibling services to link to. Every page still
        renders — nothing here is a security boundary — but the numbers may be missing entirely.
      </p>
    </aside>
  )
}

/**
 * "Nobody here is holding anything for you."
 *
 * THE ONE SENTENCE THIS SURFACE MUST NOT LET A STRANGER MISS, and the mirror of the pool console's
 * standing payout notice. On every other CloudsForge product a reader's balance is held by
 * CloudsForge, and that is the assumption they arrive with. Here it is false in both directions: no
 * deposit is taken, and no support desk can move anything back. Both halves of that are load
 * bearing, and only the first is good news.
 *
 * It is DELIBERATELY not dismissible. A dismissed notice is a notice the next reader on the same
 * machine never sees, and this is the assumption a shared browser gets most wrong.
 */
export function NotCustodiedNotice() {
  return (
    <aside className="xc-notice xc-notice--custody" role="note">
      <p className="xc-notice__title">Your coins stay in your own wallet</p>
      <p className="xc-notice__body">{NOT_CUSTODIED}</p>
    </aside>
  )
}
