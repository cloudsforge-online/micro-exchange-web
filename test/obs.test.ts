/**
 * The browser observability envelope.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS IS TESTED BECAUSE THE ESTATE ALREADY SHIPPED IT BROKEN FOR MONTHS, IN SIX FRONTENDS AT ONCE.
 *
 * Not one browser event ever reached Lantern. Three defects, each alone sufficient, and every one
 * of them invisible from the browser: the path was `/ingest/browser` and Lantern serves
 * `/ingest/client`; the envelope key was `events` and Lantern reads `samples`; the record key was
 * `type` and there is no `type` column — `kind` is CHECK-constrained to six values.
 *
 * The reason none of it was noticed is the reason this file exists. A cross-origin POST that 404s
 * carries no CORS headers, so the page is told `TypeError: Failed to fetch` — byte-for-byte what it
 * is told when the host does not exist — and the caller was a bare `catch {}` around a promise
 * whose result was never read. Fixing only the path makes it WORSE: the answer becomes
 * `202 {"stored":0}`, a batch accepted and discarded in full, reported as a success.
 *
 * So what is checked here is the SHAPE, against the contract in `lantern/src/rum.ts` and the CHECK
 * constraints in `lantern/src/migrations.ts` — not against any document describing them. A shape
 * test is the only kind that could have caught this, because every other signal said it was fine.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { envelope, enqueueBounded, kindFor, type RumKind, type RumSample } from '../src/lib/obs.ts'
import { stripComments, read } from './sources.ts'

/** Lantern's `kind` column, CHECK-constrained to exactly these six strings. */
const LANTERN_KINDS: readonly RumKind[] = [
  'page_load',
  'first_contentful_paint',
  'largest_contentful_paint',
  'fetch_error',
  'unhandled_rejection',
  'error',
]

test('EVERY CLASSIFIER NARROWS ONTO A KIND LANTERN WILL STORE', () => {
  // Anything unrecognised becomes `error` rather than being passed through, because passing it
  // through IS the bug: an unknown kind is dropped at ingest with reason `unknown_kind`, and a
  // coarsely labelled error beats a dropped one.
  for (const type of [
    'PageLoad',
    'FirstContentfulPaint',
    'LargestContentfulPaint',
    'UnhandledRejection',
    'NetworkError',
    'RefreshFailed',
    'RefreshUnreachable',
    'NonJsonErrorBody',
    'TypeError',
    'ResourceError',
    'WindowError',
    '',
    'something nobody has written yet',
  ]) {
    assert.ok(
      LANTERN_KINDS.includes(kindFor(type)),
      `kindFor(${JSON.stringify(type)}) produced ${JSON.stringify(kindFor(type))}, which the kind ` +
        `column will refuse`,
    )
  }
})

test('the request classifiers stay separate from the generic error', () => {
  // Keeping them apart is what lets a dashboard separate "the network is bad" from "this bundle
  // throws". Collapsing them all to `error` would store every sample and answer no question.
  for (const type of ['NetworkError', 'RefreshFailed', 'RefreshUnreachable', 'NonJsonErrorBody']) {
    assert.equal(kindFor(type), 'fetch_error')
  }
  assert.equal(kindFor('TypeError'), 'error')
  assert.equal(kindFor('UnhandledRejection'), 'unhandled_rejection')
})

test('THE ENVELOPE HAS THE NINE KEYS LANTERN READS AND NO OTHERS', () => {
  // `fromWire` reads these nine and IGNORES every other key. A field promoted to the top level is
  // silently discarded — which is what happened to `message`, `stack` and the caller's own `type`
  // for months.
  const sample = envelope({ app: 'pool-web', type: 'NetworkError', message: 'Failed to fetch' })
  assert.deepEqual(Object.keys(sample).sort(), [
    'app',
    'attributes',
    'kind',
    'requestId',
    'route',
    'session',
    'statusCode',
    'traceId',
    'valueMs',
  ])
})

test('everything without a column goes into attributes, including the caller’s own classifier', () => {
  const sample = envelope({
    app: 'pool-web',
    type: 'NetworkError',
    message: 'Failed to fetch',
    stack: 'at somewhere',
    context: { chain: 'ltc' },
  })
  // The precise classifier survives here even though `kind` coarsened it, so nothing is lost.
  assert.equal(sample.attributes['type'], 'NetworkError')
  assert.equal(sample.kind, 'fetch_error')
  assert.equal(sample.attributes['message'], 'Failed to fetch')
  assert.equal(sample.attributes['stack'], 'at somewhere')
  assert.deepEqual(sample.attributes['context'], { chain: 'ltc' })
  assert.match(String(sample.attributes['at']), /^\d{4}-\d{2}-\d{2}T/)
})

test('an absent stack and an absent context are absent, not null', () => {
  // `attributes` is jsonb and is what somebody greps. A key present with a null value is noise in
  // every record; an absent key is a fact.
  const sample = envelope({ app: 'pool-web', type: 'PageLoad', message: '/' })
  assert.equal('stack' in sample.attributes, false)
  assert.equal('context' in sample.attributes, false)
})

test('value_ms IS AN INTEGER COLUMN, AND A FLOAT IS REJECTED BY THE INSERT', () => {
  // Not rounded by it. `performance` hands out sub-millisecond floats, so this is the ordinary case
  // rather than an edge one — and it would have failed at the database, after the request, where
  // the browser cannot see it.
  assert.equal(envelope({ app: 'a', type: 'PageLoad', message: '/', valueMs: 1234.567 }).valueMs, 1235)
  assert.equal(envelope({ app: 'a', type: 'PageLoad', message: '/' }).valueMs, null)
})

test('the columns Lantern nulls are sent as null rather than fabricated', () => {
  const sample = envelope({ app: 'pool-web', type: 'error', message: 'x' })
  // Lantern requires exactly 32 hex characters for a trace id and nulls anything else. There is no
  // browser-side trace context on this surface, so null is the honest value.
  assert.equal(sample.traceId, null)
  assert.equal(sample.statusCode, null)
  assert.equal(sample.requestId, null)
})

test('a request id is carried through, because it is what joins this to the server’s logs', () => {
  const sample = envelope({
    app: 'pool-web',
    type: 'NetworkError',
    message: 'the pool did not answer',
    statusCode: 503,
    requestId: 'req-abc',
  })
  assert.equal(sample.statusCode, 503)
  assert.equal(sample.requestId, 'req-abc')
})

test('THE QUEUE DROPS FROM THE FRONT, KEEPING THE NEWEST', () => {
  // A render loop throwing on every frame must cost a fixed number of requests. Which end to drop
  // is not arbitrary: a loop's thousandth exception is identical to its first, whereas the state of
  // the page just before the tab closed is not.
  const at = (n: number): RumSample => envelope({ app: 'pool-web', type: 'error', message: `#${n}` })
  let queue: RumSample[] = []
  for (let i = 0; i < 100; i += 1) queue = enqueueBounded(queue, at(i))
  assert.equal(queue.length, 32)
  assert.equal(queue[0]?.attributes['message'], '#68')
  assert.equal(queue[31]?.attributes['message'], '#99')
})

test('THE INGEST PATH AND THE ENVELOPE KEY ARE THE ONES LANTERN ACTUALLY READS', () => {
  // The two constants that were wrong for months, asserted as text because they live inside a
  // function this test cannot call without a fetch. `/ingest/browser` and `{"events":[…]}` are the
  // pair that produced `TypeError: Failed to fetch` and a silent 400 respectively.
  const source = stripComments(read('src/lib/obs.ts'), 'ts')
  assert.match(source, /const INGEST_PATH = '\/ingest\/client'/)
  assert.match(source, /JSON\.stringify\(\{ samples: batch \}\)/)
  assert.ok(!source.includes('/ingest/browser'))
  assert.ok(!/\{ events:/.test(source))
})

test('A 2xx IS NOT TREATED AS SUCCESS', () => {
  // `202 {"stored":0}` is the shape of a batch accepted and discarded in full. Believing it is what
  // let three separate defects survive; reading the body is the whole correction.
  const source = stripComments(read('src/lib/obs.ts'), 'ts')
  assert.match(source, /outcome\.stored < batch\.length/)
  assert.match(source, /console\.warn/)
})

test('THE REPORTER NEVER REPORTS ITSELF, AND NEVER THROWS', () => {
  // Rule 1 and rule 2. A failed report producing a report is an outage amplifier, and a browser can
  // generate them faster than an ingest can shed them. Asserted as an absence of `report(` inside
  // `flush`, and by the fact that `report` itself is wrapped.
  const source = stripComments(read('src/lib/obs.ts'), 'ts')
  const flush = source.slice(source.indexOf('export async function flush'), source.indexOf('async function safeBody'))
  assert.ok(!/\breport\(/.test(flush), 'flush() reports its own failure, which amplifies an outage')
  assert.match(source, /export function report[\s\S]*?try \{/)
})

test('no identity is sent, because Lantern has no column to put one in', () => {
  // By policy that service has no `user_id` anywhere, so an identity sent here would be dropped
  // rather than stored — and on this surface the only identifier in play is a mining address, which
  // is the last thing that should leave the page.
  const sample = envelope({ app: 'pool-web', type: 'error', message: 'x' })
  assert.equal(sample.session, null, 'there is no sessionStorage in this process, so there is no id')
  const source = stripComments(read('src/lib/obs.ts'), 'ts')
  assert.ok(!/\baccount\b|\baddress\b|\buserId\b/.test(source))
})
