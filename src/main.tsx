/**
 * The boot sequence. The order is not arbitrary.
 *
 *   1. Observability first, so an exception thrown by anything below is reported rather than lost.
 *      A crash during the first render is the single most valuable event this app can send.
 *   2. `initAnalytics()` second — see the note beside the call.
 *   3. Render last.
 *
 * ── There is no `bootstrapSession()` here, and its absence is the point ────────────────────────
 *
 * Every other frontend in the estate awaits an SSO hand-off before mounting. This one has nothing to
 * hand off, and the reason is stronger here than anywhere else it has been made: THERE IS NO
 * CLOUDSFORGE SERVICE BEHIND THIS SURFACE AT ALL. There is no `micro-exchange`. Every number on
 * every page is an `eth_call` against a public JSON-RPC endpoint, this bundle has no `lib/auth.tsx`
 * and `lib/hosts.ts` has no `apiBase()`, and a CloudsForge session is not a credential any chain
 * node has ever heard of.
 *
 * So a bootstrap here would be a round trip against the identity service on every page load whose
 * result nothing in this bundle could read — and it would put a "Sign in" affordance beside the
 * Connect button, implying the two are alternatives. They are not: the identity that decides what a
 * reader can do here is an address in their own wallet, which CloudsForge did not issue and cannot
 * revoke, and only one of the two can sign a swap. See the header of src/components/shell.tsx.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@cloudsforge/ui/tokens.css'
import '@cloudsforge/ui/ui.css'
import './styles.css'
import { initAnalytics } from '@cloudsforge/ui/consent'
import { App } from './app.tsx'
import { initObs } from './lib/obs.ts'

initObs()

/*
 * Consent Mode is primed with every category DENIED before anything else runs — two pushes onto a
 * plain array, no request, no cookie — and the analytics tag is loaded ONLY if this reader granted
 * consent on a previous visit. A first-time reader gets nothing until they press Accept.
 *
 * It goes here, before the render, rather than inside a component, because the denied default has to
 * be in place before any tag could conceivably arrive; a default installed after a script has begun
 * running is a race, and the losing branch of that race sets a cookie.
 */
initAnalytics()

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
