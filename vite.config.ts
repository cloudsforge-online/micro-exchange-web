import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * There is deliberately no `define`, no `envPrefix` and no `.env` file in this repository.
 *
 * A build-time constant is an environment baked into an image, and an image with an environment
 * baked into it has to be rebuilt to be promoted — which means the artefact that reaches
 * production is not the artefact that passed CI. Every host this app talks to is resolved at
 * RUNTIME from `window.location.hostname`; see `src/lib/hosts.ts`.
 * `test/no-build-time-config.test.ts` fails the build if `import.meta.env.VITE_` ever reappears.
 *
 * That rule bites harder here than on most surfaces, because of what a build-time constant would
 * be a constant OF. This bundle's only remote is a chain: the JSON-RPC endpoint at `rpc.<apex>`,
 * composed in `src/lib/rpc.ts` from the page's own address and the viewed network. A `VITE_RPC_URL`
 * would mean an image built for mainnet, and the failure mode is not a broken page — it is a
 * working one. The form renders, the balances load, the Swap button is live, and the wallet is
 * asked to sign against a chain the reader did not choose. The chain-mismatch banner is the last
 * thing standing between them and that signature, and it can only exist because the endpoint is
 * derived from the address in the bar rather than from something baked in.
 *
 * The contract addresses are the same argument from the other side: they ARE committed, in
 * `src/lib/dex.ts`, keyed by chain id — because they are facts about a chain rather than about a
 * deployment, and `/contracts` re-derives them in the reader's browser so nobody has to take this
 * repository's word for them. Committed is not the same as configured.
 */
export default defineConfig({
  plugins: [react()],
  // ── THE MOUNT, AND IT IS AN ADDRESS RATHER THAN AN ENVIRONMENT ──────────────────────────────────
  //
  // `/exchange` is the same string on localhost, on testnet, on mainnet and in a preview, because it
  // is a fact about how the estate composes this surface's URLs rather than about which estate is
  // serving it. That is what separates it from the build-time configuration this repository refuses
  // everywhere else: the ORIGIN still varies per request and is still resolved in the browser.
  //
  // It is `subdomain: ''` + `basePath: '/exchange'` in `ui/packages/ui/src/surfaces.ts`, and
  // `src/lib/routes.ts` holds the copy this bundle reads — see `BASE` there for the router-path /
  // public-path distinction the rest of the repository turns on.
  //
  // TRAILING SLASH REQUIRED. vite joins `base` to an asset name by concatenation, so `/exchange`
  // emits `/exchangeassets/index-a1b2.js` — a 404 for the bundle on every page, with a build that
  // succeeds and a dev server that is unaffected because it serves from memory.
  base: '/exchange/',
  resolve: {
    // @cloudsforge/ui is a `link:` dependency, so its own node_modules holds a second copy of
    // React. Two copies means two dispatchers, and the shared bar throws on its first useState.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // The linked package is edited in the same working tree until it is published; pre-bundling
    // it would freeze a stale copy.
    exclude: ['@cloudsforge/ui'],
  },
  build: {
    // The assets are immutable-cached by nginx, which is only safe when every rebuild produces a
    // new filename. Sourcemaps so a Lantern stack trace names a line somebody can find.
    sourcemap: true,
  },
  // 5194. The estate's frontends sit in 5170–5199, and this file arrived from pool-web carrying
  // 5191 — WHICH IS POOL-WEB'S. Two frontends on one port is not a bind error you notice once and
  // fix: whichever `pnpm dev` starts second fails, and whichever started first goes on answering,
  // so the symptom is the pool being served at the exchange's address. Re-checked against every
  // sibling `vite.config.ts` on 2026-08-16 rather than incremented.
  //
  // It is also this surface's `devPort` in `ui/packages/ui/src/surfaces.ts`, which is unusual and
  // deliberate: a devPort is the port of the thing you CALL, and for every other surface that is a
  // service. There is no `micro-exchange` to call, so the only thing that answers for `exchange` on
  // a local checkout is this dev server — and a registry number naming nothing was what 4150 was.
  server: { port: 5194 },
  preview: { port: 5194 },
})
