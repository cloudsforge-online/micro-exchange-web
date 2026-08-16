/**
 * The route table, the router and the web server, cross-checked as text.
 *
 * ── WHY THIS IS A TEXT TEST RATHER THAN A RENDER TEST ─────────────────────────────────────────
 *
 * Three separate artefacts decide which addresses this bundle answers, and only two of them are
 * JavaScript:
 *
 *   `src/lib/routes.ts`  — `ROUTES`, which the sub-navigation and the nginx cross-check derive from
 *   `src/app.tsx`        — the `<Route>` elements the router actually mounts
 *   `nginx.conf`         — the enumerated `location` blocks, which decide the HTTP STATUS
 *
 * A render test can see the first two disagree. Nothing that runs in this process can see the third
 * at all: nginx is not imported, it is not typechecked, and a route added to the router without a
 * matching `location` still renders perfectly in every test in this directory. It fails only in
 * production, and it fails QUIETLY — the address answers 404, the shell is served under it by
 * `error_page`, React renders the right page, and the only symptom is that a crawler and an uptime
 * check both believe a working page is missing. That is a defect nobody reports.
 *
 * So the config is read as a string. It is the only way this repository can hold nginx to anything.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NAV, NON_INDEX_PATHS, ROUTES, poolPath, swapPath } from '../src/lib/routes.ts'
import { read, stripComments } from './sources.ts'

const nginx = stripComments(read('nginx.conf'), 'nginx')
const appSource = read('src/app.tsx')
const app = stripComments(appSource, 'ts')

/** Every `path=` on a `<Route>` in app.tsx, plus `''` for the index route. */
function routerPaths(): string[] {
  const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1] ?? '')
  if (/<Route\s+index\b/.test(app)) paths.unshift('')
  return paths
}

test('every route in the table is mounted by the router', () => {
  const mounted = routerPaths()
  for (const route of ROUTES) {
    const matches = mounted.filter((p) => p === route.path || p.startsWith(`${route.path}/`))
    assert.ok(
      matches.length > 0,
      `ROUTES declares ${JSON.stringify(route.path)} but no <Route> in src/app.tsx mounts it, so ` +
        `the navigation links to an address that renders the not-found page`,
    )
  }
})

test('the router mounts nothing the table does not declare', () => {
  for (const path of routerPaths()) {
    // The catch-all is not a route; it is what happens when none of them matched.
    if (path === '*') continue
    const head = path.split('/')[0] ?? ''
    assert.ok(
      ROUTES.some((route) => route.path === head),
      `src/app.tsx mounts ${JSON.stringify(path)}, which is not in ROUTES — so nginx.conf will not ` +
        `have a location for it and the address answers 404 in production while passing every ` +
        `render test here`,
    )
  }
})

test('WILDCARD IS NOT DECORATION: it is what decides the nginx form', () => {
  // `location = /pools` matches that one address and nothing beneath it. A route with children
  // needs the prefix form, and getting this backwards is the failure this flag exists to prevent:
  // `/pools/0x…` is the address this surface asks people to paste into a conversation, and if
  // nginx only enumerated `/pools` it would 404 on the one link that matters.
  for (const route of ROUTES) {
    const hasChildren = routerPaths().some((p) => p.startsWith(`${route.path}/`))
    assert.equal(
      route.wildcard,
      hasChildren,
      `ROUTES says ${JSON.stringify(route.path)} wildcard=${route.wildcard}, but src/app.tsx ` +
        `${hasChildren ? 'does' : 'does not'} mount children beneath it`,
    )
  }
})

test('NGINX ENUMERATES EVERY ROUTE, AND THE INDEX IS EXACT', () => {
  // `location = /` and not `location /`: the prefix form would match every address on the surface
  // and turn the whole "unknown paths answer 404" argument in nginx.conf's header into a comment.
  assert.match(nginx, /location\s*=\s*\/\s*\{/, 'nginx.conf has no exact-match location for the index')

  for (const path of NON_INDEX_PATHS) {
    // The alternation form `location ~ ^/(pools|contracts)(/|$)` is one block for several routes,
    // so this looks for the path INSIDE a regex location rather than for a block of its own.
    const found = [...nginx.matchAll(/location\s+[~^=]*\s*([^\s{]+)\s*\{/g)].some((m) =>
      (m[1] ?? '').includes(path),
    )
    assert.ok(
      found,
      `nginx.conf enumerates no location matching ${JSON.stringify(path)}. A route the server does ` +
        `not know answers 404 with the shell under it: the page renders, and the status line says ` +
        `it does not exist. Add it to the alternation in nginx.conf.`,
    )
  }
})

test('nginx enumerates nothing that is not a route', () => {
  // The mirror of the test above, and the one that catches a route being REMOVED. A stale
  // alternation is worse than a missing one: it answers 200 for an address the router no longer
  // knows, which is the "every address is a success" failure the enumeration exists to stop.
  const alternations = [...nginx.matchAll(/location\s+~\s+\^\/\(([^)]+)\)/g)].flatMap((m) =>
    (m[1] ?? '').split('|'),
  )
  for (const alt of alternations) {
    assert.ok(
      NON_INDEX_PATHS.includes(alt),
      `nginx.conf serves the app shell for /${alt}, which is not in ROUTES — that address answers ` +
        `200 with a not-found page, which is a success status on a missing page`,
    )
  }
})

test('THE SPA FALLBACK IS ABSENT AND error_page IS PRESENT', () => {
  // The single most important line in nginx.conf, asserted as an absence because it is the default
  // everybody reaches for. `try_files $uri /index.html` answers 200 for every address in existence.
  assert.doesNotMatch(
    nginx,
    /try_files\s+\$uri\s+(\$uri\/\s+)?\/index\.html/,
    'nginx.conf has the SPA fallback, which makes "page not found" a 200 — see its own header',
  )
  assert.match(nginx, /error_page\s+404\s+\/index\.html/)
})

test('the sitemap lists the routes a crawler should have, and NOT one pair’s address', () => {
  const sitemap = nginx.slice(nginx.indexOf('location = /sitemap.xml'))
  for (const path of ['', ...NON_INDEX_PATHS]) {
    assert.ok(
      sitemap.includes(`$host/${path}`) || (path === '' && sitemap.includes('<loc>$scheme://$host<')),
      `/${path} is a route and is not in the sitemap`,
    )
  }
  // `/pools/<address>` is unbounded — one address per market, minted by whoever calls
  // `createPair` — so the set is not this repository's to enumerate and would be stale the moment
  // it was written. It is also a CLAIM: a pair address in the one document a crawler treats as
  // authoritative reads as this site vouching for that market, and an exchange whose factory is
  // permissionless cannot vouch for any of them. Argued in full in nginx.conf.
  assert.doesNotMatch(sitemap, /pools\//)
  assert.doesNotMatch(sitemap, /0x[0-9a-fA-F]{40}/)
})

test('NOTHING ON THIS SURFACE IS GATED, AND THERE IS NOTHING TO GATE IT WITH', () => {
  // There is no CloudsForge service behind this bundle at all: every read is an anonymous
  // `eth_call` against a public chain and every write is signed by the reader's own wallet. A
  // guard here would put a login in front of facts that are public by construction, and would
  // imply an account this surface deliberately does not have. Asserted as an absence, because the
  // reflex is to add one back — and comments are stripped first because src/app.tsx NAMES what it
  // refuses in order to explain it.
  for (const forbidden of ['ProtectedRoute', 'RequireAuth', 'AuthProvider', 'useSession']) {
    assert.ok(
      !app.includes(forbidden),
      `src/app.tsx references ${forbidden}; every route on this surface renders for everybody`,
    )
  }
})

test('the navigation is derived from the table and cannot drift from it', () => {
  assert.deepEqual(
    NAV.map((item) => item.to),
    ROUTES.filter((r) => r.label !== null).map((r) => `/${r.path}`),
  )
  // Every navigation target is an address nginx serves. A link in the header that 404s is the
  // easiest of these failures to ship and the most embarrassing to find.
  for (const item of NAV) {
    const path = item.to.replace(/^\//, '')
    assert.ok(path === '' || NON_INDEX_PATHS.includes(path))
  }
})

test('a pool link is a route nginx serves, lower-cased and encoded', () => {
  const built = poolPath('0xAbCdEf0123456789AbCdEf0123456789AbCdEf01')
  assert.equal(built, '/pools/0xabcdef0123456789abcdef0123456789abcdef01')
  assert.ok(NON_INDEX_PATHS.includes(built.split('/')[1] ?? ''))
  // LOWER-CASED, because a pair address reaches this builder from three places that disagree about
  // case: `getPair` returns it unchecksummed, a reader pastes it checksummed, and the page compares
  // it as a string against a CREATE2 derivation. One canonical form in the URL means one cache
  // entry, one history entry and one `===` that behaves.
  //
  // Encoded as well, even though a hex address needs no escaping. The segment is somebody's typed
  // input — `/pools/:pair` accepts anything, deliberately, so that a mistyped address gets an
  // explanation from the pool page rather than the not-found page — and a link builder that assumes
  // its input is clean breaks the first time it is handed something that is not an address.
  assert.equal(poolPath('a/b c'), '/pools/a%2Fb%20c')
})

test('a swap link is a QUERY on the index route, and that is the distinction it draws', () => {
  // `/pools/0x…` identifies a market; this identifies a DRAFT — which tokens the form should start
  // on. A draft is not part of a resource's identity, so it belongs in the query, and a reader who
  // then changes the tokens does not accumulate a history entry per keystroke of a form they are
  // still filling in.
  const built = swapPath('0xAAAA', '0xBBBB')
  assert.equal(built, '/?from=0xaaaa&to=0xbbbb')
  assert.ok(built.startsWith('/?'), 'a swap link must be the index route, which nginx serves exactly')
})

test('there is no liquidity route and no positions route, and that is a decision', () => {
  // Both would need write paths this surface has not built. A menu entry leading to an explanation
  // of why a feature is absent is worse than the absence: it implies somebody decided against it
  // rather than that phase H scoped this surface to a swap, a list and a proof.
  for (const route of ROUTES) {
    assert.ok(!/liquidit|position|portfolio|dashboard|earning/i.test(route.path))
    assert.ok(!/liquidit|position|portfolio|dashboard|earning/i.test(route.label ?? ''))
  }
  assert.doesNotMatch(nginx, /location[^\n]*(liquidit|position)/i)
})

test('THIS CONTAINER PROXIES NOTHING, WHICH IS THE SURFACE’S OWN ARGUMENT', () => {
  // A `/rpc` here would look like a kindness and would cost the surface its main claim. The page
  // says the reader's browser talks to the chain and to nothing else; a proxy on this hostname
  // would put a CloudsForge server between a reader and the contract they were invited to check,
  // and from inside the browser it would be indistinguishable from a server answering
  // `getReserves()` with whatever it liked. `/contracts` re-runs the CREATE2 derivation locally
  // precisely so nothing served from here has to be trusted; a proxy would make that theatre.
  assert.doesNotMatch(nginx, /proxy_pass/)
})

test('routes.ts imports nothing, so this test can read it without a bundler', () => {
  // The module's own claim, checked. An import of a `.css` or of `@cloudsforge/ui` here would make
  // this file unloadable outside vite, and this cross-check would quietly stop running.
  assert.doesNotMatch(read('src/lib/routes.ts'), /^\s*import\s/m)
})
