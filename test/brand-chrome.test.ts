/**
 * The four bytes-on-disk this surface needs of its own, and the mark it deliberately does not have.
 *
 * ── WHY A SEPARATE HOSTNAME NEEDS ANY ASSETS AT ALL ───────────────────────────────────────────
 *
 * "A browser tab and a shared link inherit nothing" (`brand/plan.ts`). Favicons are per-origin and
 * an og card is per-URL, so `exchange.<apex>` gets a blank tab and a blank link preview unless it
 * carries its own copies — no matter what the apex serves.
 *
 * ── THEY ARE THE COMPANY'S, NOT ANOTHER PRODUCT'S, AND THAT IS THE DECISION THIS FILE PINS ────
 *
 * micro-brand has no `exchange` set: there is no `brand/assets/exchange/` directory and no
 * `exchange` entry in the plan. Generating one from a frontend repository is the one place brand
 * assets must never come from, so something has to be borrowed — and every remaining candidate
 * except the parent is ANOTHER PRODUCT'S MARK. Forge Create's struck spark on a Forge Exchange link
 * preview does not read as "no card yet", it reads as Forge Create; Forge Network's would say this
 * is chain infrastructure, which pool-web and explorer-web can say and a registered product with an
 * accent ramp of its own cannot. CloudsForge's own ridge-and-flame is the one card in micro-brand
 * that is true of every surface the estate serves.
 *
 * NOTE THAT THE ACCENT IS NOT BORROWED. `data-cf-product="exchange"` names a real block in
 * tokens.css, so the page is in the exchange's own gold while the tab icon is the parent's — which
 * is the correct way round: the ramp is generated from the registry and the card is not.
 *
 * The bytes are compared IN BOTH DIRECTIONS against the sibling checkout, so "copied from brand"
 * stays true rather than becoming "copied from brand once, in March". And the absence of
 * `brand/assets/exchange/` is asserted too, so the day micro-brand generates one is the day a test
 * tells somebody to come back here and swap them.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ACCENT_SURFACE } from '../src/lib/hosts.ts'
import { ROOT, SIBLINGS, read, stripComments } from './sources.ts'

const INDEX_HTML = read('index.html')
const HTML = stripComments(INDEX_HTML, 'html')
const DOCKERFILE = stripComments(read('Dockerfile'), 'nginx')
const PUBLIC = join(ROOT, 'public')

/** The four artefacts, and what each one is for. */
const CHROME = [
  'favicon-32x32.png',
  'favicon-192x192.png',
  'favicon-512x512.png',
  'og-1200x630.png',
] as const

/**
 * micro-brand's checkout, or null.
 *
 * Absent for somebody who cloned only this repository, and the comparison then cannot run. CI
 * checks the sibling out (see `.github/workflows/ci.yml`) and FAILS THE JOB if it is missing, so
 * this skip cannot become a permanent silence on the runner — which is where it would matter.
 */
function brandDir(): string | null {
  const dir = join(SIBLINGS, 'brand/assets/site')
  return existsSync(dir) ? dir : null
}

test('the brand chrome is byte-identical to CloudsForge’s own', (t) => {
  const dir = brandDir()
  if (!dir) return t.skip('micro-brand is not checked out beside this repository')

  for (const asset of CHROME) {
    const ours = readFileSync(join(PUBLIC, asset))
    const theirs = readFileSync(join(dir, asset))
    assert.ok(
      ours.equals(theirs),
      `public/${asset} differs from brand/assets/site/${asset}. These are copies rather than ` +
        `originals: a divergence here means somebody re-exported an icon in a frontend repository, ` +
        `which is where brand assets must never be made.`,
    )
  }
})

test('THERE IS STILL NO EXCHANGE BRAND SET, WHICH IS WHY THESE ARE BORROWED', (t) => {
  if (!brandDir()) return t.skip('micro-brand is not checked out beside this repository')
  assert.equal(
    existsSync(join(SIBLINGS, 'brand/assets/exchange')),
    false,
    'brand/assets/exchange/ now exists. That is good news and it retires a decision: this surface ' +
      "borrows CloudsForge's own favicons and og card only because micro-brand had no set for the " +
      'exchange. Copy the exchange set into public/ and update the argument in index.html; the ' +
      "accent ramp needs no change, because [data-cf-product='exchange'] has been real all along.",
  )
})

test('public/ carries the chrome and nothing else', () => {
  // A mark or a wordmark is NOT one of the two artefacts a separate hostname needs, and adding one
  // should be a decision rather than a reflex — so the absence is asserted. Nothing in src renders
  // a mark and nothing in index.html links one.
  assert.deepEqual(readdirSync(PUBLIC).sort(), [...CHROME].sort())
  assert.doesNotMatch(HTML, /mark-|wordmark-|social-/)
})

test('index.html links four icons and exactly one og block', () => {
  const icons = [...HTML.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*>/g)]
  assert.equal(icons.length, 4, 'index.html should link three icon sizes plus the apple-touch icon')
  for (const tag of icons) {
    const href = /href="\/([^"]+)"/.exec(tag[0])?.[1]
    assert.ok(href && CHROME.includes(href as (typeof CHROME)[number]), `${href} is not in public/`)
  }

  // ONE og block, not two. foresight-web declares og:type, og:title and og:description twice; the
  // second set silently wins in every crawler and the first is dead text nobody edits. Counted per
  // property so a duplicate cannot hide behind a differently ordered second block.
  for (const property of ['og:type', 'og:title', 'og:description', 'og:image']) {
    const count = [...HTML.matchAll(new RegExp(`property="${property}"`, 'g'))].length
    assert.equal(count, 1, `index.html declares ${property} ${count} times`)
  }

  // The card image is RELATIVE, so it resolves against whichever origin served the page — the same
  // rule the rest of this bundle follows for hosts, and the reason one image serves every estate.
  assert.match(HTML, /property="og:image" content="\/og-1200x630\.png"/)
})

test('THE ACCENT SELECTOR THIS PAGE NAMES REALLY EXISTS', () => {
  // The check that catches a silent fall-through either way. A product with no block in tokens.css
  // falls back to the company ember in complete silence — which tokens.css calls out by name: "a
  // silent fallthrough is a latent bug, so every key an app may set is declared". `admin` had this
  // defect and `explorer` still does. `exchange` has a real block, and this is what proves it.
  const tokens = readFileSync(join(ROOT, 'node_modules/@cloudsforge/ui/src/tokens.css'), 'utf8')
  const named = /data-cf-product="([a-z-]+)"/.exec(HTML)?.[1]
  assert.equal(named, ACCENT_SURFACE, 'index.html and ACCENT_SURFACE disagree about the accent ramp')
  assert.ok(
    tokens.includes(`[data-cf-product='${named}']`),
    `tokens.css has no [data-cf-product='${named}'] block, so this page falls through to the ` +
      `company ember with nothing to say so`,
  )
  // The other two attributes are set statically on <html> for the same reason: a page that paints
  // before they land flashes the default ramp and then changes colour.
  assert.match(HTML, /data-cf-substrate="warm"/)
  assert.match(HTML, /data-cf-scheme="auto"/)
})

test('THE IMAGE ACTUALLY CONTAINS public/', () => {
  // The web template's Dockerfile once did not copy public/ into the build context, so four
  // frontends shipped an image with no icon in it while their own brand test passed. Committing the
  // bytes and serving them are two different claims, and only the second one a reader can see.
  assert.match(DOCKERFILE, /COPY\s+public\s+\.\/public/)
})

test('color-scheme is spelled the way the standard spells it', () => {
  // Not the way English does. It is not a registered meta name under any other spelling, so a
  // misspelling is INERT rather than wrong — explorer-web shipped `colour-scheme` for months and
  // drew light form controls on a dark page the whole time. This surface has two <select>s, a text
  // input and a set of radios on the first page a reader opens, so the same defect would be visible
  // immediately.
  assert.match(HTML, /<meta name="color-scheme" content="dark light" \/>/)
  assert.doesNotMatch(HTML, /colour-scheme/)
})
