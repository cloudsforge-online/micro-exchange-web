/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ARTEFACT THAT PASSED CI IS THE ARTEFACT THAT REACHES PRODUCTION.
 *
 * A `VITE_` variable is read when the bundle is BUILT and frozen into the output. So a bundle built
 * for testnet cannot be promoted to mainnet — it has to be rebuilt, and the thing that reaches
 * production is then a different artefact from the one every gate in this repository examined. The
 * estate's release path pins ONE image per deployable by digest, which quietly assumes the image is
 * environment-free; a `VITE_API_URL` breaks that assumption without breaking any test.
 *
 * Everything this bundle needs to know about where it is comes from `window.location.hostname` at
 * runtime, through `src/lib/hosts.ts`. The two things that are not hosts — the release identifier
 * and the analytics measurement id — are `<meta>` tags in index.html, which the Dockerfile stamps
 * into a copy of the file rather than into the JavaScript.
 *
 * ── THE SECOND HALF: THIS BUNDLE CARRIES NO CREDENTIAL AND SENDS NONE ─────────────────────────
 *
 * There is no service behind this surface. Every read is a JSON-RPC call to a Hearth node, which
 * takes no bearer token from anybody, and every write is an `eth_sendTransaction` handed to the
 * reader's own wallet. So there is nothing to send and nothing to store. Asserted as an ABSENCE,
 * because the reflex when a request is refused is to add a header, and the tempting place to add it
 * — an `Authorization` in an nginx `proxy_pass` — puts a CloudsForge service credential inside an
 * image that is built once and promoted to every environment, which is a published credential.
 *
 * ── THE THIRD HALF, AND ON THIS SURFACE IT IS THE EXPENSIVE ONE ───────────────────────────────
 *
 * A wrong ADDRESS here spends a reader's money into a contract nobody controls. `src/lib/dex.ts`
 * keys the deployment on the chain id the reader's own node reports, and the tests below hold that
 * shape from the other side: no address is composed out of the page's hostname, no key is ever in
 * this bundle, and nginx never stands between a reader and the chain.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { ROOT, read, stripComments } from './sources.ts'

/** Every source file under src/, with its comments removed. */
function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx|css)$/.test(entry)) continue
      out.push({
        path: relative(ROOT, full),
        text: stripComments(read(relative(ROOT, full)), entry.endsWith('.css') ? 'css' : 'ts'),
      })
    }
  }
  walk(join(ROOT, 'src'))
  return out
}

const SRC = sources()
const INDEX_HTML = stripComments(read('index.html'), 'html')
const VITE_CONFIG = stripComments(read('vite.config.ts'), 'ts')
const NGINX = stripComments(read('nginx.conf'), 'nginx')
const DOCKERFILE = stripComments(read('Dockerfile'), 'nginx')

test('NO BUILD-TIME ENVIRONMENT REACHES THIS BUNDLE', () => {
  for (const { path, text } of [...SRC, { path: 'index.html', text: INDEX_HTML }]) {
    for (const forbidden of [/import\.meta\.env/, /\bVITE_[A-Z]/, /\bprocess\.env\b/]) {
      const hit = text.match(forbidden)
      assert.equal(
        hit,
        null,
        `${path} reads ${JSON.stringify(hit?.[0])}. That value is frozen into the artefact at ` +
          `build time, so the image cannot be promoted between environments — the thing that ` +
          `reaches production stops being the thing that passed CI. Derive it from ` +
          `window.location at runtime, in src/lib/hosts.ts.`,
      )
    }
  }
})

test('vite is not configured to inject one either', () => {
  // `define` and `envPrefix` are the two ways to smuggle a build-time constant past the grep above:
  // `define` replaces an arbitrary identifier at transform time, and `envPrefix` widens which
  // variables `import.meta.env` exposes. Neither leaves a `VITE_` in src.
  assert.doesNotMatch(VITE_CONFIG, /\bdefine\s*:/)
  assert.doesNotMatch(VITE_CONFIG, /\benvPrefix\b/)
  assert.doesNotMatch(VITE_CONFIG, /\bloadEnv\b/)
})

test('NO CLOUDSFORGE HOSTNAME IS WRITTEN DOWN IN THIS BUNDLE', () => {
  // A literal hostname is a second, unversioned copy of the surface registry, and the copy is the
  // one that will be wrong. It is also a build-time environment wearing a different hat: an image
  // naming `pool.cloudsforge.online` is an image that only works on one estate.
  for (const { path, text } of SRC) {
    const hit = text.match(/[a-z0-9-]+\.cloudsforge\.(online|dev|test)/i)
    assert.equal(
      hit,
      null,
      `${path} names ${JSON.stringify(hit?.[0])}. Hosts are derived from window.location.hostname ` +
        `through src/lib/hosts.ts, so one image serves localhost, a preview and both estates.`,
    )
  }
})

test('THE DEPLOYMENT IS CHOSEN BY CHAIN ID, NEVER BY THE ADDRESS OF THE PAGE', () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // The most tempting derivation on this surface and by far the most expensive one to get wrong.
  //
  // There are two Hearths — 7411 and 7412 — and the factory, the router and WEMBER are at
  // DIFFERENT addresses on each. A page that picked between them by looking at its own hostname
  // would be right until the day a reader used the network switcher, opened a wallet still pointed
  // at the other chain, and pressed Swap: the transaction would go to an address that on THAT chain
  // is either nothing at all or somebody else's contract. Neither outcome is recoverable, and
  // neither shows up as an error on screen first.
  //
  // So the key is `eth_chainId`, asked of the reader's own wallet or node, and the table is
  // `DEPLOYMENTS` in `src/lib/dex.ts`. A hostname cannot enter that decision: `hosts.ts` is not
  // imported by `dex.ts` at all, and no address literal may be built out of anything.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const dex = SRC.find((s) => s.path === 'src/lib/dex.ts')
  assert.ok(dex, 'src/lib/dex.ts has moved; this check reads it by name')
  assert.match(dex.text, /export function deploymentFor\(chainId: number \| null\)/)
  assert.ok(
    !/from '\.\/hosts'|from '\.\.\/lib\/hosts'/.test(dex.text),
    'src/lib/dex.ts imports hosts.ts. The deployment is keyed by chain id; a hostname reaching ' +
      'this module is the one input that can put mainnet addresses in front of a testnet reader.',
  )
  // Hex IS built by interpolation all over this bundle, and every one of those is legitimate:
  // `abi.ts` decodes a word the chain returned, `dex.ts` re-derives the pair by CREATE2, `wallet.ts`
  // renders a quantity. What must never appear inside one is the page's own address — that is the
  // defect this test is named for, and it is the only shape of it a grep can catch.
  for (const { path, text } of SRC) {
    for (const composed of text.match(/`0x\$\{[^`]*`/g) ?? []) {
      assert.ok(
        !/location|hostname|hosts\(|pageOrigin|viewedNetwork/.test(composed),
        `${path} builds an address out of where the page is: ${composed}. The deployment is keyed ` +
          'by the chain id the reader\'s own node reports; nothing about the hostname may reach it.',
      )
    }
  }
})

test('THERE IS NO SIGNER IN HERE, AND NO KEY FOR ONE TO USE', () => {
  // The wallet is the identity on this surface: `src/lib/wallet.ts` BUILDS a transaction and hands
  // it to the reader's provider with `eth_sendTransaction`, which is the request that opens their
  // wallet's own confirmation screen. Every other shape of the same idea is forbidden here —
  // `eth_sendRawTransaction` means something in this bundle signed, and a signature means a key.
  //
  // This is not hypothetical hygiene: `@cloudsforge/hearth-wallet-core` exists, it is a real
  // dependency of the browser extension, and importing it here would work. It must not: a bundle
  // served from a CloudsForge origin that can sign is a bundle whose compromise spends readers'
  // money, and the whole custody claim in the chrome depends on it being unable to.
  for (const { path, text } of SRC) {
    for (const forbidden of [
      /eth_sendRawTransaction/,
      /\bprivateKey\b/i,
      /\bmnemonic\b/i,
      /hearth-wallet-core/,
      /\bsecp256k1\b/i,
    ]) {
      const hit = text.match(forbidden)
      assert.equal(
        hit,
        null,
        `${path} names ${JSON.stringify(hit?.[0])}. This bundle cannot sign and must not be able ` +
          'to: it builds the transaction and the reader\'s own wallet signs it.',
      )
    }
  }
  const wallet = SRC.find((s) => s.path === 'src/lib/wallet.ts')
  assert.ok(wallet, 'src/lib/wallet.ts has moved; this check reads it by name')
  assert.match(wallet.text, /method: 'eth_sendTransaction'/)
})

test('THIS BUNDLE HOLDS NO CREDENTIAL AND SENDS NONE', () => {
  for (const { path, text } of SRC) {
    for (const forbidden of [/\bAuthorization\b/, /\bBearer\b/, /localStorage/, /document\.cookie/]) {
      const hit = text.match(forbidden)
      assert.equal(
        hit,
        null,
        `${path} uses ${JSON.stringify(hit?.[0])}. Every route micro-pool serves is anonymous, so ` +
          `a credential here would be a secret shipped in a public bundle to authenticate nothing.`,
      )
    }
  }
  // sessionStorage IS used, once, for the pseudonymous per-tab observability id. It dies with the
  // tab, it says nothing about who the reader is, and Lantern has no user column to put it in.
  const withSession = SRC.filter((s) => /sessionStorage/.test(s.text)).map((s) => s.path)
  assert.deepEqual(withSession, ['src/lib/obs.ts'])
})

test('the image proxies nothing, so no credential can be added to it later', () => {
  // The tempting fix for an authority gap is an nginx proxy with a header on it. An image is built
  // once and promoted; a credential inside one is compromised on the first deploy.
  assert.doesNotMatch(NGINX, /proxy_pass/i)
  assert.doesNotMatch(NGINX, /Authorization|Bearer/i)
  assert.doesNotMatch(DOCKERFILE, /TOKEN|SECRET|PASSWORD/i)
})

test('NGINX DOES NOT STAND BETWEEN THE READER AND THE CHAIN', () => {
  // The cross-origin read to `rpc.<apex>` costs a preflight and one allowlist entry in the estate's
  // `cf-cors`, and a `/rpc` prefix on this hostname would have avoided both. It would also have put
  // a CloudsForge server in the path of every call a reader made to verify us — which is the one
  // thing this surface exists not to do, and which nobody could detect from the page.
  //
  // So: no `stream` block, no chain port named, no upstream. `proxy_pass` itself is asserted absent
  // in the test above, for the credential reason; this is the same absence for the custody reason.
  assert.doesNotMatch(NGINX, /^\s*stream\s*\{/m)
  assert.doesNotMatch(NGINX, /^\s*upstream\s+/m)
  assert.doesNotMatch(NGINX, /listen\s+854[05]/)
})

test('the release and the analytics id are identities, not configuration', () => {
  // Both are meta tags rather than build-time constants: they NAME the artefact and the property it
  // reports to, they do not tell it where it is running. The Dockerfile stamps the release into a
  // copy of index.html, which is why an image can be promoted and still be traceable.
  assert.match(INDEX_HTML, /<meta name="cf-release" content="dev" \/>/)
  assert.match(DOCKERFILE, /ARG RELEASE/)
  assert.match(DOCKERFILE, /cf-release/)
  // And no third-party analytics script tag: `@cloudsforge/ui/consent` injects the tag from exactly
  // one place, the Accept button. A cookie set before consent is not cured by a banner under it —
  // and on this surface the path being reported would name a mining address.
  assert.doesNotMatch(INDEX_HTML, /<script[^>]+src="https?:\/\//)
})

test('THE ONE REMOTE ADDRESS IS COMPOSED, AND IT IS DELIBERATELY CROSS-ORIGIN', () => {
  // Every other bundle in the estate keeps `apiBase()` at `''` so its requests are same-origin and
  // need no CORS. This one cannot: the chain node is not this surface's own hostname and never will
  // be. `rpc.<apex>` is a different origin from `exchange.<apex>`, which is precisely why the
  // gateway's `cf-cors` middleware has to list this surface among the origins it answers for.
  //
  // So the assertion here is not "no absolute URL". It is that the absolute URL is BUILT FROM THE
  // PAGE, one label at a time, and that no hostname is written down anywhere to build it from —
  // the rule the rest of this file enforces, applied to the one place it is hardest to keep.
  const hosts = stripComments(read('src/lib/hosts.ts'), 'ts')
  assert.doesNotMatch(hosts, /apiBase/, 'there is no CloudsForge service behind this surface')

  const rpc = stripComments(read('src/lib/rpc.ts'), 'ts')
  assert.match(rpc, /export function rpcUrl\(\)/)
  // The scheme is fixed, the environment is a SUFFIX on the first label, and the apex is whatever
  // the page was served from. `rpc.testnet.<apex>` would be a second label, which Cloudflare's
  // one-level Universal SSL wildcard fails to present a certificate for.
  assert.match(rpc, /'rpc-testnet' : 'rpc'/)
  assert.match(rpc, /`https:\/\/\$\{label\}\.\$\{apex\}`/)
  // And the apex is the page's hostname with its first label removed, rather than a constant.
  assert.match(rpc, /parts\.slice\(1\)\.join\('\.'\)/)
  assert.doesNotMatch(rpc, /cloudsforge\.online/)
})
