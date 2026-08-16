/**
 * The CloudsForge session, and the ONE call this surface makes with it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS NOW, WHEN THREE OTHER FILES IN THIS REPOSITORY ARGUED IT SHOULD NOT
 *
 * `main.tsx`, `app.tsx` and `components/shell.tsx` each carried a section explaining that there was
 * no session on this surface. The argument was: there is no `micro-exchange`, every number comes
 * from an `eth_call`, and the identity that can sign a swap is a key in the reader's own wallet
 * rather than anything CloudsForge issues. All of that is still true, and none of it was ever the
 * question the reader was asking. The owner's report, 2026-08-16:
 *
 *   "i tried url directly its open but it has no login bar on top"
 *
 * The bar is not an authorisation mechanism, it is the ESTATE'S CHROME. It carries the product
 * switcher, the network switcher, the CloudsForge home link and the reader's own handle, and every
 * other surface in the estate has it. A page that drops it does not read as "this page needs no
 * account" — it reads as a page that fell off the estate. The old argument proved that this surface
 * must never GATE anything on a session, which is a different claim, and that one still holds: read
 * `app.tsx`, there is no guard in front of any route and there must not be one.
 *
 * So the rule for this file is narrow and worth stating plainly:
 *
 *   - **A bearer never travels to a chain node.** `lib/rpc.ts` composes the JSON-RPC address and
 *     issues every `eth_call`; nothing in it imports this module, and nothing here knows it exists.
 *     A node would ignore an `authorization` header, but sending one would put a CloudsForge access
 *     token in the logs of an endpoint that is public by construction.
 *   - **Nothing branches on the session.** No page reads it, no read is skipped without it, and no
 *     route is gated by it. Its entire consumer is `CloudsForgeBar`: a handle, and the `adminOnly`
 *     switcher entries an operator is allowed to see.
 *
 * The single-flight refresh is carried over verbatim in shape from the surfaces that have actually
 * been run against Nimbus, because the failure it prevents is not hypothetical: N requests that all
 * 401 on an expired access token must perform ONE refresh, or N-1 of them present a token that has
 * just been superseded against a rotating refresh token and sign the reader out of a live session.
 * There is only one request on this surface today, which makes the machinery look like overkill —
 * it is here because the day a second one is added is not the day anybody will remember why.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import {
  attemptSilentSignIn,
  consumeAuthCallback,
  signInRedirect,
  signOutRedirect,
} from '@cloudsforge/ui'
import { APP_NAME, hosts } from './hosts.ts'
import { report } from './obs.ts'

/** Nimbus issues and refreshes tokens; it is cross-origin from every app, always. */
function nimbusUrl(): string {
  return hosts().nimbus
}

/**
 * The shared CloudsForge token keys.
 *
 * Deliberately the same strings in every product: a session established at the Account portal is
 * picked up here without a second round trip, and signing out of one app on a shared machine clears
 * the tokens the next app would have read.
 */
const ACCESS_KEY = 'cf.accessToken'
const REFRESH_KEY = 'cf.refreshToken'

/** Fired when a refresh fails. The provider listens and drops the session. */
export const AUTH_EXPIRED_EVENT = 'cf:auth-expired'

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

/* ---- token storage ------------------------------------------------- */

const memory = new Map<string, string>()

/**
 * Storage, with a memory fallback.
 *
 * `localStorage` THROWS rather than returning null in a Safari private window and in a third-party
 * iframe with storage blocked. A module that touched it directly would take the whole bundle down
 * at import time in both — and on this surface that means a public price page that renders nothing
 * because of a feature it does not use. The fallback loses the session on reload, which is a worse
 * experience than persistence and a very much better one than a blank page.
 */
function store(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      // Probe rather than trust: the throw happens on ACCESS, not on the typeof check.
      localStorage.getItem(ACCESS_KEY)
      return localStorage
    }
  } catch {
    // Fall through to memory.
  }
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  }
}

export const getAccessToken = (): string | null => store().getItem(ACCESS_KEY)
export const getRefreshToken = (): string | null => store().getItem(REFRESH_KEY)

export function setTokens(tokens: AuthTokens): void {
  store().setItem(ACCESS_KEY, tokens.accessToken)
  store().setItem(REFRESH_KEY, tokens.refreshToken)
}

export function clearTokens(): void {
  store().removeItem(ACCESS_KEY)
  store().removeItem(REFRESH_KEY)
}

export const hasSession = (): boolean => Boolean(getAccessToken() && getRefreshToken())

/* ---- the single-flight refresh ------------------------------------- */

let inflightRefresh: Promise<boolean> | null = null

/**
 * Refresh the session, at most once concurrently.
 *
 * Every caller that arrives while a refresh is in flight awaits THE SAME promise; the slot is
 * cleared when it settles, so the next 401 after this one starts a fresh attempt rather than
 * replaying a stale answer.
 */
export function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return Promise.resolve(false)
  if (!inflightRefresh) {
    inflightRefresh = performRefresh(refreshToken).finally(() => {
      inflightRefresh = null
    })
  }
  return inflightRefresh
}

async function performRefresh(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${nimbusUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      // Returning false signs the reader out either way, but the two causes are not the same event:
      // a 401 is an expired refresh token and routine, anything else is Nimbus failing. They are
      // indistinguishable for as long as neither is written down.
      if (res.status !== 401) {
        report({
          app: APP_NAME,
          type: 'RefreshFailed',
          message: `Token refresh failed (${res.status})`,
          statusCode: res.status,
          requestId: res.headers.get('x-request-id'),
        })
      }
      return false
    }
    setTokens((await res.json()) as AuthTokens)
    return true
  } catch (err) {
    // The message only. NEVER the error object and never the URL it carries: Node and every browser
    // put the full request URL in a fetch rejection, and an estate credential has leaked that way
    // before. `nimbusUrl()` is a public hostname with no userinfo, which is why it is reportable at
    // all — and it is reported as its own field rather than by printing what was thrown.
    report({
      app: APP_NAME,
      type: 'RefreshUnreachable',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
      context: { nimbus: nimbusUrl() },
    })
    return false
  }
}

function expireSession(): void {
  clearTokens()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
}

/* ---- the one request ------------------------------------------------ */

/** What identity answers at `/auth/me`, narrowed to what this surface needs. */
export interface MeResponse {
  user?: {
    id?: string | null
    handle?: string | null
    roles?: readonly string[] | null
  } | null
}

export interface Reader {
  readonly handle: string | null
  readonly roles: readonly string[]
}

export const NOBODY: Reader = { handle: null, roles: [] }

/**
 * Read the reader out of an `/auth/me` body.
 *
 * ── THE SHAPE IS NESTED, AND THE ESTATE GOT THIS WRONG AT THE ROOT ────────────────────────────
 *
 * Identity answers `{ user: {...}, session: {...}, organisations: [...] }` — the profile is NESTED
 * under `user`. The route is `GET /auth/me` in `identity/src/server.ts` and the body is built by
 * `toPublicUser` in `identity/src/users.ts`. The web template once declared `interface Me { handle?,
 * roles? }` and read both off the TOP level, where they are not; four frontends inherited it,
 * `roles` was then always empty, and the switcher hid every `adminOnly` entry from every signed-in
 * operator. That is exactly the consequence that would show up here — an operator opening the
 * exchange and finding the console missing from a menu it is supposed to be in.
 *
 * There is no flat fallback, on the template's own reasoning: tolerating one would encode a
 * response identity does not send, and the next reader could not tell which of the two is real.
 *
 * A pure function so `test/session.test.ts` can prove the shape without a browser.
 */
export function readReader(body: unknown): Reader {
  if (typeof body !== 'object' || body === null) return NOBODY
  const nested = (body as MeResponse).user
  if (typeof nested !== 'object' || nested === null) return NOBODY
  return {
    handle: typeof nested.handle === 'string' && nested.handle.length > 0 ? nested.handle : null,
    roles: Array.isArray(nested.roles)
      ? nested.roles.filter((r): r is string => typeof r === 'string')
      : [],
  }
}

/**
 * Fetch the signed-in reader, or `null` when there is nobody.
 *
 * The only network call in this file, and the only one in the bundle that is not an `eth_call`. It
 * is allowed to fail quietly — an unreachable identity service must not take a page of public
 * prices down with it — which is why the caller gets `null` rather than a rejection for everything
 * except the one case it can act on.
 */
export async function fetchReader(): Promise<Reader | null> {
  const token = getAccessToken()
  if (!token) return null
  const send = () =>
    fetch(`${nimbusUrl()}/auth/me`, {
      headers: { accept: 'application/json', authorization: `Bearer ${getAccessToken() ?? ''}` },
    })

  let res: Response
  try {
    res = await send()
    if (res.status === 401 && getRefreshToken()) {
      if (await refreshSession()) {
        res = await send()
      } else {
        expireSession()
        return null
      }
    }
  } catch {
    // Deliberately NOT reported with the caught value: a fetch rejection carries the whole request
    // URL, and this one is built with a bearer in its headers. An identity service that cannot be
    // reached is also not an event worth a report from a page that does not need it.
    return null
  }

  if (res.status === 401) {
    expireSession()
    return null
  }
  if (!res.ok) return null
  try {
    return readReader(await res.json())
  } catch {
    return null
  }
}

/* ---- boot and sign-in ---------------------------------------------- */

/**
 * Redeem an SSO hand-off code, if the Account portal sent us back with one.
 *
 * Called once from `main.tsx` BEFORE React renders, so the first paint already knows whether there
 * is a session and no chrome flashes signed-out and then signed-in.
 *
 * The strip-then-exchange ordering inside `consumeAuthCallback` is load-bearing and is documented
 * where it is implemented: the code leaves the address bar before it goes over the wire, so it is
 * never in the history, in a referrer, or in a screenshot taken while the request is in flight.
 * Nothing here may reorder that, and nothing here may re-read `location.hash` afterwards.
 *
 * IDENTITY MUST KNOW THIS ORIGIN OR THE REDEEM IS REFUSED. `identity/src/handoff.ts` checks the
 * caller against `IDENTITY_HANDOFF_ORIGINS`, and `https://exchange…` was added to that list in
 * `deploy/compose/docker-compose.estate.yml` in the same change that added this file. Without the
 * deploy half, a reader who pressed Sign in would come back here and be silently signed out — which
 * is a worse bug than the missing bar, because it looks like a broken account rather than a missing
 * feature.
 */
export async function bootstrapSession(): Promise<boolean> {
  try {
    const tokens = await consumeAuthCallback()
    if (tokens) {
      setTokens(tokens)
      return true
    }
  } catch (err) {
    // A failed exchange is a signed-out boot, not a broken app: the sign-in button is right there.
    // The message and stack only — see the note in `performRefresh`.
    report({
      app: APP_NAME,
      type: 'AuthCallbackFailed',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
    })
  }
  // ── COLLECT A SESSION THIS ORIGIN CANNOT SEE ────────────────────────────────────────────────
  //
  // Tokens live in `localStorage`, scoped to one origin, and every surface in the estate is its own
  // origin — so a reader signed in at the portal arrives here and is shown a signed-out bar. This
  // asks the apex ONCE per tab, and only when the `cf_sso` cookie hint says a session exists
  // somewhere. An anonymous visitor is never redirected: with no hint `attemptSilentSignIn` returns
  // false, so a stranger reading a price is not sent through an identity round trip to do it.
  const local = hasSession()
  if (attemptSilentSignIn(local)) {
    // A navigation has started and this document is going away. Answer "no session" so nothing
    // paints a signed-out shell in the moments before it does.
    return false
  }
  return local
}

/**
 * Send the browser to the Account portal, returning here afterwards.
 *
 * `returnTo` defaults to the CURRENT URL including its path and query, which is what puts a reader
 * who signed in from a pool page back on that pool rather than on the swap form.
 */
export function signIn(returnTo?: string): void {
  signInRedirect(returnTo ?? (typeof window === 'undefined' ? undefined : window.location.href))
}

/** Clear this app's tokens FIRST — the portal cannot reach them — then end the shared session. */
export function signOut(returnTo?: string): void {
  clearTokens()
  signOutRedirect(returnTo ?? (typeof window === 'undefined' ? undefined : window.location.origin))
}

/** Reset module state. Tests only. */
export function __resetSession(): void {
  inflightRefresh = null
  memory.clear()
}
