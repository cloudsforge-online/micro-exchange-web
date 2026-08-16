/**
 * An address this app does not own.
 *
 * The document this renders inside was served with a REAL 404: nginx.conf enumerates this app's
 * routes and everything else falls through to `error_page 404 /index.html`, which keeps the status
 * line honest while still serving the shell. So this screen and the HTTP status agree, and a crawler,
 * a link checker and a person all reach the same conclusion.
 *
 * That matters more here than on most surfaces. An exchange nobody can find has no liquidity, so this
 * site is indexed on purpose — and a bundle that answered 200 for every path would offer a search
 * engine an unbounded set of blank pages under this hostname.
 *
 * ── THE MOST LIKELY WAY TO ARRIVE HERE IS A MISTYPED PAIR ADDRESS ─────────────────────────────
 *
 * `/pools/:pair` accepts anything, so a truncated or mistyped address lands on the pool page rather
 * than here and gets a better message there. What reaches this screen is a path this app never had.
 */
import { Link } from 'react-router-dom'
import { NAV } from '../lib/routes.ts'

export function NotFoundPage() {
  return (
    <div className="xc-page">
      <h1 className="xc-title">Page not found</h1>
      <p className="xc-lede">
        This address is not one of ours. The server said 404 as well as this screen, so a link
        checker and a person reach the same conclusion — and a missing page here says nothing about
        the contracts, which are on the chain and unaffected by anything a web server does.
      </p>
      <p>Everything this site does hold:</p>
      <ul className="xc-links">
        {NAV.map((item) => (
          <li key={item.to}>
            <Link to={item.to}>{item.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
