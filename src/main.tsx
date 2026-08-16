/**
 * The boot sequence. The order is not arbitrary.
 *
 *   1. Observability first, so an exception thrown by anything below is reported rather than lost.
 *      A crash during the first render is the single most valuable event this app can send.
 *   2. `initAnalytics()` second — see the note beside the call.
 *   3. `bootstrapSession()` third — see below.
 *   4. Render last.
 *
 * ── 2026-08-16: `bootstrapSession()` IS HERE NOW, AND THIS RECORDS WHAT REPLACED WHAT ─────────
 *
 * This block used to argue the opposite, and the argument is preserved because half of it is still
 * load-bearing: THERE IS NO CLOUDSFORGE SERVICE BEHIND THIS SURFACE. There is no `micro-exchange`,
 * `lib/hosts.ts` has no `apiBase()`, every number on every page is an `eth_call` against a public
 * JSON-RPC endpoint, and a CloudsForge session is not a credential any chain node has heard of. All
 * of that still holds — it is why `lib/auth.tsx` gates nothing and why `lib/rpc.ts` never sees a
 * bearer.
 *
 * What it concluded was that a bootstrap would be "a round trip against the identity service on
 * every page load whose result nothing in this bundle could read". Something reads it now: the
 * shared bar, which this surface was missing entirely (the owner: "it has no login bar on top").
 * And the round trip is not on every page load. `bootstrapSession` redeems a hand-off code only if
 * the portal sent one, and otherwise asks the apex ONCE per tab and only when the `cf_sso` cookie
 * hint says a session exists somewhere — so a stranger opening this page to read a price makes no
 * identity request at all.
 *
 * It is AWAITED before `createRoot`, which is the whole reason it is here rather than in an effect:
 * the first paint already knows whether there is a session, so the chrome never flashes signed-out
 * and then signed-in. It cannot reject — every failure inside it is caught and reported, and a
 * signed-out boot is a normal outcome rather than an error — but the `.catch` is kept anyway,
 * because a bundle that fails to render a public price page because the account service is down
 * would be the exact defect this surface exists to not have.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@cloudsforge/ui/tokens.css'
import '@cloudsforge/ui/ui.css'
import './styles.css'
import { initAnalytics } from '@cloudsforge/ui/consent'
import { App } from './app.tsx'
import { initObs } from './lib/obs.ts'
import { bootstrapSession } from './lib/session.ts'

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

void bootstrapSession().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
