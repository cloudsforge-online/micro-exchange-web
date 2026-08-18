/**
 * Creating a market.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE FACTORY IS PERMISSIONLESS, AND THAT WAS CHECKED AGAINST THE DEPLOYED CONTRACT.
 *
 * A button that always fails is worse than no button, so this was not taken on trust from the
 * source. `createPair(address,address)` was `eth_call`ed on BOTH deployed factories — 7411 and 7412
 * — from an address with no relationship to this project and no balance, and both answered with a
 * pair address rather than reverting. Re-calling it for a pair that already exists reverts with
 * `HearthV2: PAIR_EXISTS`, which is a state check rather than an authorisation one. The only
 * functions on that contract that look at `msg.sender` are `setFeeTo` and `setFeeToSetter`, and
 * neither is reachable from this bundle.
 *
 * So: anybody may create a market for any two tokens, and this page renders that as a real button.
 * The three ways it can fail are all decidable before gas is spent, and all three are checked here
 * rather than left to a revert:
 *
 *   IDENTICAL_ADDRESSES — the same token twice.
 *   ZERO_ADDRESS        — either side is `0x00…0`.
 *   PAIR_EXISTS         — the factory has already made this one. The page links to it instead.
 *
 * ── AN EMPTY PAIR IS NOT A MARKET YET, AND THE PAGE SAYS SO ─────────────────────────────────
 *
 * Creating a pair mints nothing and holds nothing. Until somebody deposits, it quotes no price and
 * every swap through it reverts. Most people should not send this transaction at all: the router
 * creates a missing pair on its way through `addLiquidity`, so a first deposit into a pair that
 * does not exist is ONE signature rather than two. This page exists because creating a market and
 * leaving it for somebody else to seed is a legitimate thing to want, and because a create that
 * only ever happened as a side effect of a deposit could not be explained to the person doing it.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, NoEndpoint, NoExchange } from '../components/states.tsx'
import { Transactions } from '../components/transactions.tsx'
import { checksumAddress, isAddress } from '../lib/abi.ts'
import { useChain } from '../lib/chain.tsx'
import { pairFor, type Deployment } from '../lib/dex.ts'
import { hosts } from '../lib/hosts.ts'
import { readPairAddress, readToken, type TokenMeta } from '../lib/market.ts'
import { useResource } from '../lib/resource.ts'
import { addLiquidityPath, poolPath } from '../lib/routes.ts'
import { useTransactions } from '../lib/tx.ts'
import { useWalletAddress } from '../lib/usewallet.tsx'
import {
  buildCreatePairTransaction,
  getProvider,
  isUserRejection,
  sendTransaction,
} from '../lib/wallet.ts'

export function NewPoolPage() {
  const chain = useChain()
  if (chain.status === 'unknown') return <Loading label="Finding the chain" />
  if (chain.status === 'unreachable') return <NoEndpoint />
  if (chain.status === 'no-exchange' || chain.deployment === null) {
    return <NoExchange chainId={chain.chainId} />
  }
  return <NewPoolForm deployment={chain.deployment} />
}

function NewPoolForm({ deployment }: { readonly deployment: Deployment }) {
  const estate = hosts()
  const wallet = useWalletAddress()
  const provider = useMemo(() => getProvider(), [])

  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const validA = isAddress(a.trim())
  const validB = isAddress(b.trim())
  const lowerA = validA ? a.trim().toLowerCase() : null
  const lowerB = validB ? b.trim().toLowerCase() : null
  const identical = lowerA !== null && lowerA === lowerB
  const zero = [lowerA, lowerB].some((x) => x !== null && /^0x0{40}$/.test(x))
  const pickable = lowerA !== null && lowerB !== null && !identical && !zero

  /**
   * What each address actually is, read from it.
   *
   * A pair can be created for any two addresses, including addresses with no code — the factory
   * does not check, and it is not its job to. This surface is not going to pretend it validated
   * something it cannot, but it CAN report what the two addresses said when asked, and "this
   * address would not say what it is called or how many decimals it has" is the difference between
   * a token and a typo.
   */
  const tokens = useResource(
    async () => {
      if (lowerA === null || lowerB === null) return null
      const [tokenA, tokenB] = await Promise.all([
        readToken(lowerA, deployment),
        readToken(lowerB, deployment),
      ])
      return { tokenA, tokenB }
    },
    [lowerA, lowerB, deployment.chainId],
    { enabled: lowerA !== null && lowerB !== null },
  )

  const existing = useResource(
    () =>
      pickable
        ? readPairAddress(deployment, lowerA as string, lowerB as string)
        : Promise.resolve(null),
    [lowerA, lowerB, deployment.chainId, pickable],
    { enabled: pickable },
  )
  // `readPairAddress` answers null both for "no pair" and for a read that failed, and the two are
  // told apart by the resource's own state rather than by the value — `failed` covers both, and a
  // page that offered "create" during an outage would be offering a transaction that reverts.
  const alreadyExists = existing.data !== null
  const checking = existing.state === 'loading'

  // The address the pair WOULD have, derived in this browser by CREATE2 rather than asked for. It
  // is known before the transaction is sent, which is what makes the link below honest.
  const derived = pickable ? pairFor(deployment, lowerA as string, lowerB as string) : null

  const txs = useTransactions(
    useCallback(() => {
      existing.reload()
    }, [existing.reload]),
  )
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const create = useCallback(async () => {
    if (provider === null || wallet.address === null || lowerA === null || lowerB === null) return
    setBusy(true)
    setProblem(null)
    try {
      const hash = await sendTransaction(
        provider,
        buildCreatePairTransaction({
          factory: deployment.factory,
          tokenA: lowerA,
          tokenB: lowerB,
          from: wallet.address,
        }),
      )
      txs.track('New pool', hash)
    } catch (err: unknown) {
      if (!isUserRejection(err)) {
        setProblem(err instanceof Error ? err.message : 'The wallet did not send it.')
      }
    } finally {
      setBusy(false)
    }
  }, [provider, wallet.address, lowerA, lowerB, deployment.factory, txs.track])

  const wrongChain = wallet.chainId !== null && wallet.chainId !== deployment.chainId

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <p className="xc-eyebrow">
          <Link to="/pools">Pools</Link>
        </p>
        <h1 className="xc-title">Create a market</h1>
        <p className="xc-lede">
          The factory on {deployment.chainName} takes no owner and checks no caller: anybody may
          create a pool for any two tokens. It will not check what they are, and neither will this
          page — a market existing says nothing about what is in it.
        </p>
      </header>

      <div className="xc-swap">
        <section className="xc-panel xc-swap__form" aria-label="Create a market">
          <label className="xc-field">
            <span className="xc-field__label">First token</span>
            <input
              className="cf-input cf-input--mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={a}
              aria-label="First token address"
              onChange={(e) => setA(e.target.value)}
            />
            <span className="xc-field__note">
              {a.trim() === ''
                ? 'A twenty-byte contract address.'
                : !validA
                  ? 'That is not a contract address.'
                  : describe(tokens.data?.tokenA)}
            </span>
          </label>

          <label className="xc-field">
            <span className="xc-field__label">Second token</span>
            <input
              className="cf-input cf-input--mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={b}
              aria-label="Second token address"
              onChange={(e) => setB(e.target.value)}
            />
            <span className="xc-field__note">
              {b.trim() === ''
                ? 'A twenty-byte contract address.'
                : !validB
                  ? 'That is not a contract address.'
                  : describe(tokens.data?.tokenB)}
            </span>
          </label>

          <CreateAction
            busy={busy}
            available={wallet.available}
            connecting={wallet.connecting}
            connected={wallet.address !== null}
            wrongChain={wrongChain}
            chainName={deployment.chainName}
            incomplete={!validA || !validB}
            identical={identical}
            zero={zero}
            checking={checking}
            alreadyExists={alreadyExists}
            existingAddress={existing.data}
            onConnect={wallet.connect}
            onSwitch={() => void wallet.requestChain(deployment.chainId)}
            onCreate={() => void create()}
          />

          {problem !== null && (
            <p className="xc-problem" role="alert">
              {problem}
            </p>
          )}
          <Transactions transactions={txs.transactions} estate={estate} onForget={txs.forget} />
        </section>

        <section className="xc-panel xc-swap__curve" aria-label="What creating a market does">
          <h2 className="xc-panel__title">What this would do</h2>
          <dl className="xc-facts">
            <div className="xc-facts__row">
              <dt>
                The address it would have
                <span className="xc-facts__hint">
                  Derived in this browser by CREATE2 from the factory address and the pair
                  init-code hash — the same derivation the router does. It is known before the
                  transaction is sent, which is why the link below can exist already.
                </span>
              </dt>
              <dd className="cf-num xc-facts__wrap">
                {derived === null ? '—' : checksumAddress(derived)}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>What it would hold</dt>
              <dd>
                Nothing. A new pair has no reserves, quotes no price, and every swap routed through
                it reverts until somebody deposits both tokens.
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>Who may do it</dt>
              <dd>
                Anybody. There is no allowlist, no fee and no owner check on this call — verified
                against the deployed factory on both Hearth chains, not assumed from the source.
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>Whether you need to</dt>
              <dd>
                Probably not. Depositing into a pair that does not exist yet creates it in the same
                transaction, which is one signature instead of two.{' '}
                {derived !== null && (
                  <Link to={addLiquidityPath(derived)}>Go straight to the deposit</Link>
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  )
}

/** What an address said about itself, or that it said nothing. */
function describe(token: TokenMeta | undefined): string {
  if (token === undefined) return 'Reading it…'
  if (token.symbol === null && token.decimalsAssumed) {
    return 'Nothing at this address answered as a token. A pool can still be created for it, and it would be useless.'
  }
  if (token.symbol === null) return 'This address would not say what it is called.'
  if (token.decimalsAssumed) return `${token.symbol}, which would not say how many decimals it has.`
  return `${token.symbol}, with ${token.decimals} decimals, read from the contract itself.`
}

/** The one next action. Order is behaviour; see `SwapAction` in `pages/swap.tsx`. */
function CreateAction(props: {
  readonly busy: boolean
  readonly available: boolean
  readonly connecting: boolean
  readonly connected: boolean
  readonly wrongChain: boolean
  readonly chainName: string
  readonly incomplete: boolean
  readonly identical: boolean
  readonly zero: boolean
  readonly checking: boolean
  readonly alreadyExists: boolean
  readonly existingAddress: string | null
  readonly onConnect: () => void
  readonly onSwitch: () => void
  readonly onCreate: () => void
}) {
  // The three refusals come FIRST, above the wallet branches, because they are true whether or not
  // anybody is connected and because they are the answer to the question the reader is asking.
  if (props.identical) {
    return <p className="xc-action__none">A pool holds two different tokens.</p>
  }
  if (props.zero) {
    return <p className="xc-action__none">The zero address is not a token.</p>
  }
  if (props.alreadyExists && props.existingAddress !== null) {
    return (
      <p className="xc-action__none">
        This market already exists.{' '}
        <Link to={poolPath(props.existingAddress)}>See it</Link>, or{' '}
        <Link to={addLiquidityPath(props.existingAddress)}>add liquidity to it</Link>. The factory
        would refuse a second one.
      </p>
    )
  }
  if (!props.available) {
    return (
      <p className="xc-action__none">
        No wallet is installed in this browser, so nothing here can be signed. Everything this page
        says about the factory is still readable without one.
      </p>
    )
  }
  if (!props.connected) {
    return (
      <button type="button" className="cf-btn cf-btn--ember xc-action" onClick={props.onConnect}>
        {props.connecting ? 'Waiting for the wallet…' : 'Connect a wallet'}
      </button>
    )
  }
  if (props.wrongChain) {
    return (
      <button type="button" className="cf-btn cf-btn--ember xc-action" onClick={props.onSwitch}>
        Switch your wallet to {props.chainName}
      </button>
    )
  }
  if (props.incomplete) {
    return (
      <button type="button" className="cf-btn cf-btn--ember xc-action" disabled>
        Enter two token addresses
      </button>
    )
  }
  if (props.checking) {
    return (
      <button type="button" className="cf-btn cf-btn--ember xc-action" disabled>
        Checking whether it exists…
      </button>
    )
  }
  return (
    <button
      type="button"
      className="cf-btn cf-btn--ember xc-action"
      onClick={props.onCreate}
      disabled={props.busy}
    >
      {props.busy ? 'Waiting for the wallet…' : 'Create this market'}
    </button>
  )
}
