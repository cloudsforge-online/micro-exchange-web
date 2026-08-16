/**
 * Pressing Testnet re-reads THIS page from the testnet chain, without going anywhere.
 *
 *     "i see basically that in every page when you press testnet it take you to network page
 *      testet and if you switch product its reset to mainnet"
 *
 * The report that made this a defect in every bundle rather than in three of them (micro-org#459).
 * What this file pins is the one thing the reader can see: the endpoint this app reads from follows
 * the SWITCHER, not the address bar, and it goes back when they switch back.
 *
 * ── ON THIS SURFACE THE THING THAT FOLLOWS THE SWITCH IS A CHAIN ──────────────────────────────
 *
 * Everywhere else it is an API base: a different database, holding a different set of the same
 * kinds of row. Here it is `rpc` against `rpc-testnet` — two different chains, with different
 * contracts at different addresses and coins that are worth different amounts, one of which is
 * nothing. So the failure this pins is not "the page shows stale data". It is a form that asks a
 * wallet to sign, quoting a pool from one chain while pointed at another.
 *
 * There is no `apiBase()` in `src/lib/hosts.ts` to assert against — there is no `micro-exchange`
 * and there is not going to be one — so what this reads is `rpcUrl()` from `src/lib/rpc.ts`, which
 * is this bundle's only remote address.
 *
 * No DOM. `lib/viewed.ts` holds the choice in module memory and `lib/rpc.ts` consults it per call,
 * so a stub window at a hostname is the entire environment this needs.
 *
 * The state is a MODULE's, so it outlives the test that set it — hence the reset in `afterEach`,
 * performed through the public setter with a window installed, because `setViewedNetwork`
 * normalises its argument against the hostname's own network.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { installWindow, removeWindow } from './browser-stubs.ts'
import { rpcUrl } from '../src/lib/rpc.ts'
import { setViewedNetwork, viewedHosts, viewedNetwork } from '../src/lib/viewed.ts'

/** A real address on this surface, on the mainnet estate. */
const PAGE = 'https://exchange.cloudsforge.online/'
/** A development address: no chain node is composed for it, deliberately. */
const DEV = 'http://localhost:5194/'

/** Run `body` with a window at `url`, and take the window away again whatever happens. */
function at<T>(url: string, body: () => T): T {
  installWindow(url)
  try {
    return body()
  } finally {
    removeWindow()
  }
}

describe('the in-place network view', () => {
  afterEach(() => at(PAGE, () => setViewedNetwork('mainnet')))

  it('starts on the network the hostname names, and reads that chain', () => {
    at(PAGE, () => {
      assert.equal(viewedNetwork(), 'mainnet')
      assert.equal(rpcUrl(), 'https://rpc.cloudsforge.online')
    })
  })

  it('re-points this page at the testnet CHAIN without navigating anywhere', () => {
    at(PAGE, () => {
      setViewedNetwork('testnet')
      assert.equal(viewedNetwork(), 'testnet')
      // `rpc-testnet`, and the environment is a SUFFIX on the first label rather than a second
      // label: Cloudflare's Universal SSL wildcard matches exactly one, so `rpc.testnet.<apex>`
      // fails the TLS handshake at the edge before anything in this estate sees the request.
      assert.equal(rpcUrl(), 'https://rpc-testnet.cloudsforge.online')
    })
  })

  it('goes back to the serving estate’s chain when the reader switches back', () => {
    at(PAGE, () => {
      setViewedNetwork('testnet')
      setViewedNetwork('mainnet')
      assert.equal(viewedNetwork(), 'mainnet')
      assert.equal(rpcUrl(), 'https://rpc.cloudsforge.online')
    })
  })

  it('THE APEX COMES OFF THE PAGE, so another estate reads its own chain', () => {
    // Nothing in `src/` names a CloudsForge hostname — one image is served from localhost, from a
    // preview and from two production estates. The endpoint is therefore composed, and this is the
    // assertion that it is composed rather than merely correct on the estate it was written on.
    at('https://exchange.example.test/', () => {
      assert.equal(rpcUrl(), 'https://rpc.example.test')
      setViewedNetwork('testnet')
      assert.equal(rpcUrl(), 'https://rpc-testnet.example.test')
    })
  })

  it('has NO ENDPOINT AT ALL on a development host, rather than a guessed one', () => {
    at(DEV, () => {
      assert.equal(rpcUrl(), null)
      // `NetworkSwitcher` hides itself off-registry, so no click can even produce this; the
      // assertion is that a stray `?net=` or a stale module state cannot point a local checkout at
      // the live testnet chain either.
      setViewedNetwork('testnet')
      assert.equal(rpcUrl(), null)
    })
    // A hostname the registry cannot split has no apex to compose from. Inventing one produces an
    // address that does not resolve, which surfaces as a network error with no explanation — and
    // this page's own "there is no exchange on this network" state is a better answer than a
    // spinner that never stops.
    at('https://some-preview/', () => assert.equal(rpcUrl(), null))
    at('https://cloudsforge.online/', () => assert.equal(rpcUrl(), null))
  })

  it('moves the estate links with it, so a receipt points at the chain it happened on', () => {
    // `viewedHosts()` is what the explorer links are built from. The quiet failure it rules out is
    // a testnet swap whose transaction link opens the MAINNET explorer, where the hash is simply
    // absent — which reads as the swap not having happened.
    at(PAGE, () => {
      assert.ok(!viewedHosts().explorer.includes('testnet'))
      setViewedNetwork('testnet')
      assert.match(viewedHosts().explorer, /testnet/)
      // And the chain and the explorer agree about which network they are on, which is the pairing
      // that actually matters — either one alone can be right while the pair is wrong.
      assert.match(rpcUrl() ?? '', /testnet/)
    })
  })
})
