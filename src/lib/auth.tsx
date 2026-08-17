/**
 * Session state for the tree, for the bar and for nothing else.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THERE IS NO `ProtectedRoute` HERE AND THERE MUST NEVER BE ONE.
 *
 * A gate exists to spare a reader a screen made entirely of 401s by sending them somewhere that
 * fixes it. **Nothing on this surface can produce one.** Every read in this bundle is an `eth_call`
 * against a public JSON-RPC endpoint (`lib/rpc.ts`), which has never heard of a CloudsForge session
 * and would not check one if it had. A gate here would demand an account for facts that are public
 * by construction — the defect `docs/ecosystem/15-monetisation-model.md` states as a rule: "A
 * public chain whose explorer is paywalled is not a public chain." An exchange is the same claim
 * with money attached.
 *
 * So the session is read and it is used for exactly one thing: the shared company bar — the
 * reader's handle, and the `adminOnly` entries the switcher shows an operator. **It is never
 * consulted before a request and never changes what a page renders.** `test/render.test.ts` and
 * `test/routes.test.ts` both assert that, so restoring the estate's usual shape is a decision
 * somebody has to argue for rather than a reflex.
 *
 * WHAT SIGNING IN DOES NOT DO, SAID ONCE SO IT IS NOT RE-DISCOVERED: it does not connect a wallet,
 * and it cannot sign a swap. The two identities on this page are different things — a CloudsForge
 * account, which the estate issues and can revoke, and an address in the reader's own wallet, which
 * it did not issue and cannot revoke. Only the second one can move a coin. That was the reason this
 * surface shipped with no bar at all, and it was the wrong conclusion from a correct premise: the
 * fix for two identities that are easy to confuse is to show both and label them, not to hide the
 * one the rest of the estate is built on. The Connect control lives on the swap form beside the
 * trade it authorises; the account control lives in the chrome beside every other surface's.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AccountState } from '@cloudsforge/ui'
import {
  AUTH_EXPIRED_EVENT,
  clearTokens,
  fetchReader,
  hasSession,
  NOBODY,
  signIn,
  signOut,
  type Reader,
} from './session.ts'

export type SessionStatus = 'loading' | 'anonymous' | 'signedIn'

export interface Session {
  status: SessionStatus
  account: AccountState
  reader: Reader
  signIn: (returnTo?: string) => void
  signOut: () => void
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const value = useContext(SessionContext)
  // Throwing beats returning a signed-out default: a component rendered outside the provider would
  // otherwise show an anonymous bar to a signed-in reader and nobody would ever see why.
  if (!value) throw new Error('useSession must be used inside <AuthProvider>')
  return value
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(() => (hasSession() ? 'loading' : 'anonymous'))
  const [reader, setReader] = useState<Reader>(NOBODY)

  useEffect(() => {
    if (!hasSession()) return
    let live = true
    // `fetchReader` resolves to null rather than rejecting for every cause except an expiry it has
    // already handled, which is what keeps an unreachable identity service from taking a page of
    // public prices down with it.
    void fetchReader().then((found) => {
      if (!live) return
      if (found) {
        setReader(found)
        setStatus('signedIn')
        return
      }
      // Tokens still present means identity was unreachable, not that the session ended — the bar
      // shows the handle it has (none yet) rather than flipping the reader to signed out and
      // offering them a sign-in they do not need.
      setStatus(hasSession() ? 'signedIn' : 'anonymous')
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onExpired = () => {
      clearTokens()
      setReader(NOBODY)
      setStatus('anonymous')
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const doSignOut = useCallback(() => {
    setReader(NOBODY)
    setStatus('anonymous')
    signOut()
  }, [])

  const value = useMemo<Session>(
    () => ({
      status,
      account: {
        signedIn: status === 'signedIn',
        handle: reader.handle,
        roles: reader.roles,
      },
      reader,
      signIn,
      signOut: doSignOut,
    }),
    [status, reader, doSignOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
