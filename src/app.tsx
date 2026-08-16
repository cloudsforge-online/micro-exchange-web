/**
 * The route table.
 *
 * Three things have to agree about which addresses this bundle answers, and `test/routes.test.ts`
 * reads all three as text to check they do: `ROUTES` in lib/routes.ts (which the navigation and the
 * page titles derive from), the `<Route>` elements below, and the enumerated `location` blocks in
 * nginx.conf (which is what makes an unknown address a 404 rather than a 200 with a blank page).
 *
 * ── Nothing here is gated, and there is nothing to gate it with ────────────────────────────────
 *
 * There is no `AuthProvider` in this repository and no route guard, because there is no service to
 * hold a session with. Every page here is a read of a public chain, and the only credential that
 * means anything on this surface is a private key in the reader's own wallet — which never leaves
 * it, and which this bundle only ever asks to SIGN, never to hand over. A sign-in on this surface
 * would be a gate in front of facts that are public by construction.
 *
 * ── `ChainProvider` WRAPS THE ROUTER, AND THAT ORDER IS LOAD-BEARING ──────────────────────────
 *
 * It answers the question that comes before every other one on this surface: which chain is behind
 * the endpoint, and does the exchange exist on it. `useResource` — the hook every read goes through
 * — is passed `enabled: chain.status === 'ready'` by each page, so on a network with no deployment
 * this bundle issues NO `eth_call` at all, rather than one per panel that fails and renders as a
 * fault. That is the defect micro-org#406 recorded on the pool console, avoided rather than
 * repeated.
 *
 * It is OUTSIDE the router because a context read above its own provider silently returns the
 * default, and the default here — `status: 'unknown'` — renders a loading state. A safe default is
 * exactly why the ordering has to be asserted rather than trusted to fail loudly, and
 * `test/render.test.ts` asserts it by mounting the app and checking that a chain with no exchange
 * produces no `eth_call`.
 */
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ScrollToTop } from './components/scroll-to-top.tsx'
import { AppShell } from './components/shell.tsx'
import { ChainProvider } from './lib/chain.tsx'
import { ContractsPage } from './pages/contracts.tsx'
import { NotFoundPage } from './pages/not-found.tsx'
import { PoolPage } from './pages/pool.tsx'
import { PoolsPage } from './pages/pools.tsx'
import { ReceiptsPage } from './pages/receipts.tsx'
import { SwapPage } from './pages/swap.tsx'

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ChainProvider>
        <Routes>
          <Route element={<AppShell />}>
            {/* The one page a stranger needs: one trade, against one pool. */}
            <Route index element={<SwapPage />} />
            {/*
              Two entries under one path, deliberately. `/pools` is every market the factory has
              made, which is the page that answers "is there a market for X" — a question the swap
              form cannot answer, because a form that has already been given two tokens is the
              wrong place to find out which two exist. `/pools/:pair` is one market's own address,
              which is what gets pasted into a conversation.
            */}
            <Route path="pools" element={<PoolsPage />} />
            <Route path="pools/:pair" element={<PoolPage />} />
            {/* The receipts are their own address, not a section of `/contracts`: that page proves
                nobody can take your coins, and a receipt is the case where somebody already has
                them. They also have to be linkable per network from the main site. */}
            <Route path="receipts" element={<ReceiptsPage />} />
            <Route path="contracts" element={<ContractsPage />} />
            {/* Unknown paths render inside the shell, so the reader keeps the navigation they need
                to get back out — under a real 404, which nginx.conf preserves. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </ChainProvider>
    </BrowserRouter>
  )
}
