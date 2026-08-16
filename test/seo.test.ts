/**
 * What a crawler and a link-preview fetcher are told, and the two places it is written.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE DESCRIPTION EXISTS TWICE, AND IT IS THE HONEST SENTENCE.
 *
 * `index.html` carries a `<meta name="description">` and the React shell writes the same tag on
 * every route through `applyHead`. Those are read by different fetchers: a link-preview bot
 * generally does NOT execute JavaScript, so it reads the static one and nothing else; a crawler
 * that does execute it reads whatever React wrote. If the two drift, one of them becomes a sentence
 * nobody has looked at in months — and the honest one would be whichever nobody remembered to
 * update.
 *
 * On this surface that is not a tidiness concern. The description says what the exchange IS —
 * contracts on a chain, with the reader's own wallet signing and CloudsForge holding nothing —
 * before it says anything else, because it is frequently the ONLY sentence somebody reads before
 * deciding whether the thing behind the link is a venue with a desk and a support line. That one
 * fact decides whether everything else on the page is reassuring or alarming. So it is compared
 * byte for byte.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── THE NON-MAINNET HOSTNAMES REFUSE EVERY CRAWLER, AND THAT MATTERS MORE HERE ────────────────
 *
 * A testnet exchange and a mainnet exchange are two deployments of one image on two hostnames, and
 * the page they both serve is a form that asks a wallet to sign. Somebody who searches for the
 * CloudsForge exchange and lands on the testnet copy is shown a market, a price and a Swap button
 * for coins that are worth nothing — and the transaction they sign is real on the chain it reaches.
 * `Disallow: /` on every non-mainnet hostname is what stops that page from competing for the search
 * result, so the labels nginx recognises are checked against the registry's own `ENV_LABELS` rather
 * than trusted.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENV_LABELS } from '@cloudsforge/ui/surfaces'
import { SURFACE_DESCRIPTION } from '../src/lib/hosts.ts'
import { NON_INDEX_PATHS } from '../src/lib/routes.ts'
import { read, stripComments } from './sources.ts'

const HTML = stripComments(read('index.html'), 'html')
const NGINX = stripComments(read('nginx.conf'), 'nginx')
const SHELL = stripComments(read('src/components/shell.tsx'), 'ts')

test('THE STATIC DESCRIPTION IS BYTE-IDENTICAL TO THE ONE REACT WRITES', () => {
  // The attribute is wrapped across lines by the formatter, so the value is unwrapped before
  // comparison — the bytes that matter are the ones a fetcher receives, not the ones in the file.
  const raw = /<meta\s+name="description"\s+content="([\s\S]*?)"\s*\/>/.exec(HTML)?.[1]
  assert.ok(raw, 'index.html has no description meta')
  const inHtml = raw.replace(/\s+/g, ' ').trim()
  assert.equal(
    inHtml,
    SURFACE_DESCRIPTION,
    'index.html and SURFACE_DESCRIPTION disagree. A link-preview fetcher does not run JavaScript, ' +
      'so it reads only the static one; a crawler that does run it reads only the other. The ' +
      'difference between them is a sentence nobody is reading.',
  )
  // And the sentence names what holds the money and what signs. Search results truncate, so a
  // description that mentioned custody only at the end would be cut down to "Swap EMBER and Forge
  // Create tokens" — an offer, from what a stranger would reasonably read as a venue.
  assert.match(SURFACE_DESCRIPTION, /contracts hold the liquidity/)
  assert.match(SURFACE_DESCRIPTION, /your own wallet signs every trade/)
  assert.match(SURFACE_DESCRIPTION, /CloudsForge never holds your coins/)
})

test('the shell writes the shared declaration rather than a second copy of the sentence', () => {
  // `applyHead` updates each tag IN PLACE rather than appending — the bug every hand-rolled version
  // of this has, where a five-route session ends with five description tags and the crawler reads
  // the first. Using the shared writer is the point; passing it a literal would not be.
  assert.match(SHELL, /description:\s*SURFACE_DESCRIPTION/)
  assert.ok(!/description:\s*['"`]/.test(SHELL), 'the shell writes a literal description')
})

test('the og card also says who signs and who holds nothing', () => {
  // A card is read WITHOUT the surrounding page and is the easiest place on the whole surface to
  // imply an account by accident — a title, a picture and one sentence, in a chat window, next to
  // links to services that DO hold balances for people.
  const og = /property="og:description"\s+content="([\s\S]*?)"/.exec(HTML)?.[1]?.replace(/\s+/g, ' ')
  assert.ok(og, 'index.html has no og:description')
  assert.match(og, /your own wallet signs every trade/)
  assert.match(og, /nothing here is custodied by CloudsForge/)
  // And it says the market list is open, because "anyone can create a market" is the fact that
  // makes the presence of a pool not a recommendation of what is in it.
  assert.match(og, /Anyone can create a market/)
})

test('THE ENVIRONMENT LABELS NGINX KNOWS ARE THE REGISTRY’S OWN', () => {
  // The alternation in the `map` decides which hostnames refuse every crawler. A label the registry
  // reserves and nginx does not know is a deployment that competes with mainnet in search results,
  // handing strangers a stratum address for a worthless chain.
  const map = /~\^\(\?:\[\^.\]\+-\)\?\(\?:([a-z|]+)\)\\\./.exec(NGINX)?.[1]
  assert.ok(map, 'nginx.conf has no environment map, or its shape has changed')
  assert.deepEqual(
    map.split('|').sort(),
    [...ENV_LABELS].sort(),
    'nginx.conf and @cloudsforge/ui/surfaces disagree about which first labels name an environment',
  )
})

test('the environment map catches BOTH hostname shapes', () => {
  // `(?:[^.]+-)?` is what makes it match `pool-testnet.<apex>` as well as `testnet.<apex>`, for the
  // same reason `splitEnvLabel()` upstream resolves both: the environment is a suffix on the first
  // label now and was an apex prefix before. Environment-as-suffix exists because Cloudflare's SSL
  // wildcard matches exactly ONE label, so `pool.testnet.<apex>` has no certificate.
  assert.match(NGINX, /\(\?:\[\^\.\]\+-\)\?/)
})

test('a non-mainnet hostname has no sitemap and refuses every crawler', () => {
  const sitemap = NGINX.slice(NGINX.indexOf('location = /sitemap.xml'))
  assert.match(sitemap, /if \(\$cf_env\) \{ return 404; \}/)
  const robots = NGINX.slice(NGINX.indexOf('location = /robots.txt'))
  assert.match(robots, /if \(\$cf_env\) \{ return 200 'User-agent: \*\\nDisallow: \/\\n'; \}/)
  // Mainnet allows everything and points at the sitemap. This is a public reference page whose
  // entire purpose is that a stranger with an ASIC can find it.
  assert.match(robots, /Allow: \//)
  assert.match(robots, /Sitemap: \$scheme:\/\/\$host\/sitemap\.xml/)
})

test('THE SITEMAP IS COMPOSED FROM $host, BECAUSE NOTHING HERE MAY NAME A HOSTNAME', () => {
  // A sitemap must carry ABSOLUTE URLs — the spec requires it and a crawler discards a relative
  // `<loc>` — and nothing built in this repository is allowed to name a hostname, because one image
  // serves localhost, a preview deployment and both estates. nginx is the component that knows: it
  // has `$host` on every request.
  const sitemap = NGINX.slice(NGINX.indexOf('location = /sitemap.xml'))
  assert.doesNotMatch(sitemap, /cloudsforge/)
  for (const path of ['', ...NON_INDEX_PATHS]) {
    assert.ok(sitemap.includes(`$scheme://$host${path ? `/${path}` : ''}<`))
  }
  // NOT `sitemapXml()` from @cloudsforge/ui: the shared generator composes every sibling as
  // `<subdomain>.$host`, which is right on the marketing site where `$host` IS the apex. Here
  // `$host` is already `pool.<apex>`, so the same generator would emit `network.pool.<apex>` — a
  // two-label hostname that resolves to nothing and fails the edge's one-label wildcard.
  assert.doesNotMatch(sitemap, /sitemapXml/)
  assert.equal([...sitemap.matchAll(/<loc>/g)].length, NON_INDEX_PATHS.length + 1)
})

test('the sitemap declares its own content type rather than letting nginx guess', () => {
  // `types { }` empties the mime table FOR THIS LOCATION so `default_type` is what applies. Without
  // it nginx maps the `.xml` in the URI to `text/xml` from its own table and the `default_type`
  // line is inert — a declaration that reads as a decision and is not one.
  const sitemap = NGINX.slice(NGINX.indexOf('location = /sitemap.xml'), NGINX.indexOf('location = /robots.txt'))
  assert.match(sitemap, /types \{ \}/)
  assert.match(sitemap, /default_type application\/xml;/)
})

test('this surface asks to be indexed', () => {
  // The opposite of the operator console. A pool that a stranger with an ASIC cannot find is a pool
  // with no miners, and `X-Robots-Tag: noindex` is the header that would quietly cause that.
  assert.doesNotMatch(NGINX, /X-Robots-Tag/i)
  assert.match(SHELL, /robots: 'index, follow/)
})
