/**
 * The smallest browser these tests need.
 *
 * These stubs are for the PURE layer, which in this repository is host resolution
 * (`src/lib/hosts.ts`), the JSON-RPC transport (`src/lib/rpc.ts`), the ABI codec (`src/lib/abi.ts`),
 * the formatters and the observability queue. Every one of those is a function, and putting a whole
 * document under a function is pure cost — that layer touches four globals and they are all stubbed
 * below.
 *
 * The COMPONENT layer is a different question and gets a different answer: `test/dom.ts` mounts a
 * real tree in happy-dom, because "the swap form refuses to quote when the chain did not answer" is
 * a statement about a tree after its effects have run and cannot be expressed without a document.
 * The boundary between the two files is written out at the top of that one.
 *
 * `installFetch` matters more here than it does on a surface with an API. Every read this bundle
 * makes is a POST to ONE url with a JSON-RPC envelope in the body, so the handler dispatches on
 * `method` out of the body rather than on the path — `test/fixtures.ts` is that dispatcher, and it
 * is the only place in these tests that knows what a `getReserves()` return looks like on the wire.
 */

export interface StubLocation {
  href: string
  origin: string
  hostname: string
  pathname: string
  search: string
  hash: string
  assign: (url: string) => void
}

export interface StubWindow {
  location: StubLocation
  history: { replaceState: (state: unknown, title: string, url: string) => void }
  addEventListener: () => void
  removeEventListener: () => void
  dispatchEvent: (event: Event) => boolean
}

export interface Browser {
  window: StubWindow
  /** Every side effect, in the order it happened. The auth-callback ordering test reads this. */
  trace: string[]
  /** URLs passed to history.replaceState. */
  replaced: string[]
  /** Event types dispatched on the window. */
  dispatched: string[]
  /** URLs passed to location.assign — where a sign-in redirect would have sent the browser. */
  assigned: string[]
}

/** Install a window at `url`, returning the record of what the code under test did to it. */
export function installWindow(url: string): Browser {
  const parsed = new URL(url)
  const trace: string[] = []
  const replaced: string[] = []
  const dispatched: string[] = []
  const assigned: string[] = []

  const location: StubLocation = {
    href: parsed.href,
    origin: parsed.origin,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
    assign(next: string) {
      assigned.push(next)
      trace.push(`assign:${next}`)
    },
  }

  const window: StubWindow = {
    location,
    history: {
      replaceState(_state, _title, next) {
        replaced.push(next)
        trace.push(`replaceState:${next}`)
        // A real history.replaceState updates location as well, and the ordering guarantee is
        // only meaningful if the hash is genuinely gone afterwards.
        const resolved = new URL(next, location.origin)
        location.href = resolved.href
        location.pathname = resolved.pathname
        location.search = resolved.search
        location.hash = resolved.hash
      },
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent(event: Event) {
      dispatched.push(event.type)
      trace.push(`dispatch:${event.type}`)
      return true
    },
  }

  ;(globalThis as unknown as { window?: StubWindow }).window = window
  return { window, trace, replaced, dispatched, assigned }
}

export function removeWindow(): void {
  delete (globalThis as unknown as { window?: StubWindow }).window
}

/** An in-memory Storage, so the storage path under test is the real one rather than the fallback. */
export function installStorage(seed: Record<string, string> = {}): Map<string, string> {
  const map = new Map<string, string>(Object.entries(seed))
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  return map
}

export function removeStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage
}

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
  /**
   * The signal the caller passed, so a handler can decline to settle until it aborts.
   *
   * Added to the copied-in version of this file because `src/lib/api.ts` gives every request an
   * eight-second budget, and the only way to prove that budget exists without waiting eight seconds
   * is to have the stub behave like a real fetch and reject when the signal fires. A handler that
   * ignores it behaves exactly as before.
   */
  signal: AbortSignal | undefined
}

export interface FetchStub {
  calls: FetchCall[]
  restore: () => void
}

/** Replace global fetch with `handler`, recording every call. */
export function installFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
  trace?: string[],
): FetchStub {
  const original = globalThis.fetch
  const calls: FetchCall[] = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
      signal: init?.signal ?? undefined,
    }
    calls.push(call)
    trace?.push(`fetch:${call.url}`)
    return handler(call)
  }) as typeof fetch

  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

/** A JSON response, with the request id header every CloudsForge service sets. */
export function json(status: number, body: unknown, requestId = 'req-0000'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
  })
}
