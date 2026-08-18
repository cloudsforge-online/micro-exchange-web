/**
 * Taking two tokens back out of a pool.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A WITHDRAWAL IS PRO RATA AND IT IS NOT A REFUND.
 *
 * The two amounts that come out are a proportion of what the pool holds NOW, which is not what was
 * put in. Trading changes the mix: a pool whose price has risen returns more of the token that fell
 * and less of the one that rose, and that difference — impermanent loss — becomes permanent at the
 * moment of this transaction. The page therefore shows the two amounts that would come out, in the
 * two tokens, and never a single "value", because a single value would need a price for both
 * tokens in some third unit and this surface has no oracle and no business inventing one.
 *
 * ── THE PERCENTAGE IS OF THE POOL TOKENS, NOT OF THE UNDERLYING ─────────────────────────────
 *
 * "50%" means half the LP balance, which is a claim on half of the reader's share of each reserve.
 * That is the only definition the contract can act on — `burn` takes an amount of LP — and the two
 * readings coincide anyway, but the label says "of your pool tokens" so nobody has to wonder.
 * 100% is passed through as the exact balance rather than computed, so "all of it" leaves nothing
 * behind (`portionOf` argues that).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── THE THING BEING APPROVED IS THE POOL ITSELF ─────────────────────────────────────────────
 *
 * A pair is an ERC-20 and the router has to be allowed to move the reader's balance of it, so this
 * is the one flow on the surface where the approval is for a contract with no symbol anybody
 * recognises. The button says "your pool tokens" and the panel prints the pair address, rather than
 * asking somebody to approve a bare hex string.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Limits, DEFAULT_DEADLINE_MINUTES, DEFAULT_TOLERANCE_BPS } from '../components/limits.tsx'
import { Failed, Loading, NoEndpoint, NoExchange } from '../components/states.tsx'
import { Transactions } from '../components/transactions.tsx'
import { isAddress } from '../lib/abi.ts'
import { useChain } from '../lib/chain.tsx'
import { minimumOut, portionOf, shareBps, underlyingOf, type Deployment } from '../lib/dex.ts'
import { formatBps, formatUnits, shortAddress } from '../lib/format.ts'
import { explorerAddressUrl, hosts } from '../lib/hosts.ts'
import { readAllowance, readBalance, readPair, type PairView } from '../lib/market.ts'
import { useResource } from '../lib/resource.ts'
import { addLiquidityPath, poolPath, POSITIONS_PATH } from '../lib/routes.ts'
import { useTransactions } from '../lib/tx.ts'
import { useWalletAddress } from '../lib/usewallet.tsx'
import {
  buildApproveTransaction,
  buildRemoveLiquidityTransaction,
  getProvider,
  isUserRejection,
  sendTransaction,
} from '../lib/wallet.ts'

/** The four portions offered. A slider would invite a number nobody can read back off it. */
const PORTIONS: readonly number[] = [25, 50, 75, 100]

export function RemoveLiquidityPage() {
  const chain = useChain()
  const { pair } = useParams()
  if (chain.status === 'unknown') return <Loading label="Finding the chain" />
  if (chain.status === 'unreachable') return <NoEndpoint />
  if (chain.status === 'no-exchange' || chain.deployment === null) {
    return <NoExchange chainId={chain.chainId} />
  }
  if (pair === undefined || !isAddress(pair)) {
    return (
      <div className="xc-page">
        <h1 className="xc-title">That is not a pair address</h1>
        <p className="xc-lede">
          Liquidity is withdrawn from one market, identified by its own contract address.{' '}
          <Link to={POSITIONS_PATH}>Your positions</Link> lists the ones you hold.
        </p>
      </div>
    )
  }
  return <RemoveConsole deployment={chain.deployment} address={pair.toLowerCase()} />
}

function RemoveConsole({
  deployment,
  address,
}: {
  readonly deployment: Deployment
  readonly address: string
}) {
  const view = useResource(() => readPair(deployment, address), [deployment.chainId, address])
  // Guarded on the DATA rather than on the state, for the reason `add-liquidity.tsx` sets out at
  // length: a settled withdrawal reloads this read, and a guard on `view.state` would replace the
  // form with a spinner at the moment the withdrawal was confirmed — losing the confirmation.
  if (view.data === null && view.state === 'loading') return <Loading label="Reading the pool" />
  if (view.data === null) {
    return (
      <Failed
        title="Nothing at this address answered as a pool"
        hint="The contract at this address did not return reserves. It may not be a Forge Exchange pair, or the node may be briefly unreachable."
        onRetry={view.reload}
      />
    )
  }
  return <WithdrawForm deployment={deployment} pool={view.data} onReload={view.reload} />
}

function WithdrawForm({
  deployment,
  pool,
  onReload,
}: {
  readonly deployment: Deployment
  readonly pool: PairView
  readonly onReload: () => void
}) {
  const estate = hosts()
  const wallet = useWalletAddress()
  const provider = useMemo(() => getProvider(), [])
  const owner = wallet.address

  const wrapped = deployment.wrapped.toLowerCase()
  const wrappedSide0 = pool.token0.address === wrapped
  const wrappedSide1 = pool.token1.address === wrapped
  const hasNativeSide = wrappedSide0 || wrappedSide1

  const [percent, setPercent] = useState(25)
  // Defaulted to unwrapping, because a reader who deposited EMBER expects EMBER back. The choice is
  // visible rather than implied: `removeLiquidity` returns WEMBER and `removeLiquidityETH` returns
  // the coin, and which one arrives is not something to discover afterwards.
  const [unwrap, setUnwrap] = useState(true)
  const [toleranceBps, setToleranceBps] = useState(DEFAULT_TOLERANCE_BPS)
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEFAULT_DEADLINE_MINUTES)

  const holding = useResource(
    async () => {
      if (owner === null) return null
      const [liquidity, allowance] = await Promise.all([
        readBalance(pool.address, owner),
        readAllowance(pool.address, owner, deployment.router),
      ])
      return { liquidity, allowance }
    },
    [owner, deployment.chainId, pool.address, deployment.router],
    { enabled: owner !== null },
  )

  const liquidity = holding.data?.liquidity ?? null
  const allowance = holding.data?.allowance ?? null
  const supply = pool.reserves.totalSupply
  const burning = liquidity === null ? null : portionOf(liquidity, percent)

  const out =
    burning === null || supply === null
      ? null
      : underlyingOf({
          liquidity: burning,
          totalSupply: supply,
          reserve0: pool.reserves.reserve0,
          reserve1: pool.reserves.reserve1,
        })
  const min0 = out === null ? null : minimumOut(out.amount0, toleranceBps)
  const min1 = out === null ? null : minimumOut(out.amount1, toleranceBps)
  const held = liquidity === null || supply === null ? null : shareBps(liquidity, supply)

  const txs = useTransactions(
    useCallback(() => {
      onReload()
      holding.reload()
    }, [onReload, holding.reload]),
  )
  const [busy, setBusy] = useState<'approve' | 'remove' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const send = useCallback(
    async (what: 'approve' | 'remove') => {
      if (provider === null || owner === null || burning === null || burning <= 0n) return
      setBusy(what)
      setProblem(null)
      try {
        if (what === 'approve') {
          const hash = await sendTransaction(
            provider,
            buildApproveTransaction({
              token: pool.address,
              spender: deployment.router,
              amount: burning,
              from: owner,
            }),
          )
          txs.track('Approval', hash)
        } else {
          if (min0 === null || min1 === null) return
          const hash = await sendTransaction(
            provider,
            buildRemoveLiquidityTransaction({
              router: deployment.router,
              tokenA: pool.token0.address,
              tokenB: pool.token1.address,
              liquidity: burning,
              amountAMin: min0,
              amountBMin: min1,
              from: owner,
              nowSeconds: Math.floor(Date.now() / 1000),
              aNative: wrappedSide0 && unwrap,
              bNative: wrappedSide1 && unwrap,
              deadlineSeconds: deadlineMinutes * 60,
            }),
          )
          txs.track('Withdrawal', hash)
        }
      } catch (err: unknown) {
        if (!isUserRejection(err)) {
          setProblem(err instanceof Error ? err.message : 'The wallet did not send it.')
        }
      } finally {
        setBusy(null)
      }
    },
    [
      provider,
      owner,
      burning,
      min0,
      min1,
      unwrap,
      wrappedSide0,
      wrappedSide1,
      deadlineMinutes,
      deployment.router,
      pool.address,
      pool.token0.address,
      pool.token1.address,
      txs.track,
    ],
  )

  const label0 = wrappedSide0 && unwrap ? deployment.nativeSymbol : (pool.token0.symbol ?? 'token 0')
  const label1 = wrappedSide1 && unwrap ? deployment.nativeSymbol : (pool.token1.symbol ?? 'token 1')
  const wrongChain = wallet.chainId !== null && wallet.chainId !== deployment.chainId
  const needsApproval = burning !== null && allowance !== null && allowance < burning

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <p className="xc-eyebrow">
          <Link to={poolPath(pool.address)}>
            {pool.token0.symbol ?? 'token 0'} · {pool.token1.symbol ?? 'token 1'}
          </Link>
        </p>
        <h1 className="xc-title">Remove liquidity</h1>
        <p className="xc-lede">
          Burn some of your pool tokens and take back a proportion of what the pool holds. What comes
          out is in the ratio the pool is in now, which is not the ratio you put in.
        </p>
      </header>

      <div className="xc-swap">
        <section className="xc-panel xc-swap__form" aria-label="Remove liquidity">
          <p className="xc-field__note">
            {wallet.address === null
              ? 'Connect a wallet to see what you hold in this pool.'
              : holding.state === 'loading'
                ? 'Reading your position…'
                : liquidity === null
                  ? 'Your balance of this pool could not be read.'
                  : liquidity === 0n
                    ? 'You hold none of this pool.'
                    : null}
          </p>

          {liquidity !== null && liquidity > 0n && (
            <dl className="xc-facts">
              <div className="xc-facts__row">
                <dt>Your pool tokens</dt>
                <dd className="cf-num">{formatUnits(liquidity, 18, 6)}</dd>
              </div>
              <div className="xc-facts__row">
                <dt>Your share of the pool</dt>
                <dd className="cf-num">{formatBps(held)}</dd>
              </div>
            </dl>
          )}

          <fieldset className="xc-tolerance">
            <legend className="xc-tolerance__legend">
              How much to withdraw
              <span className="xc-tolerance__hint">
                A percentage of your pool tokens. 100% burns your whole balance and leaves nothing
                in this pool.
              </span>
            </legend>
            <span className="xc-tolerance__opts">
              {PORTIONS.map((option) => (
                <label key={option} className="xc-tolerance__opt">
                  <input
                    type="radio"
                    name="portion"
                    value={option}
                    checked={percent === option}
                    onChange={() => setPercent(option)}
                  />
                  <span>{option}%</span>
                </label>
              ))}
            </span>
          </fieldset>

          {hasNativeSide && (
            <label className="xc-field xc-field--check">
              <input
                type="checkbox"
                checked={unwrap}
                onChange={(e) => setUnwrap(e.target.checked)}
              />
              <span>
                Take the {deployment.nativeSymbol} side as {deployment.nativeSymbol} rather than as
                its wrapped token. The router unwraps it in the same transaction.
              </span>
            </label>
          )}

          <Limits
            group="remove"
            toleranceBps={toleranceBps}
            onTolerance={setToleranceBps}
            deadlineMinutes={deadlineMinutes}
            onDeadline={setDeadlineMinutes}
            toleranceHint={
              'How much less than the amounts below you will accept, if somebody trades against ' +
              'this pool before your withdrawal is mined. Past it the transaction reverts.'
            }
          />

          <WithdrawAction
            busy={busy}
            available={wallet.available}
            connecting={wallet.connecting}
            connected={wallet.address !== null}
            wrongChain={wrongChain}
            chainName={deployment.chainName}
            hasPosition={liquidity !== null && liquidity > 0n}
            computed={out !== null}
            needsApproval={needsApproval}
            onConnect={wallet.connect}
            onSwitch={() => void wallet.requestChain(deployment.chainId)}
            onApprove={() => void send('approve')}
            onRemove={() => void send('remove')}
          />

          {problem !== null && (
            <p className="xc-problem" role="alert">
              {problem}
            </p>
          )}
          <Transactions transactions={txs.transactions} estate={estate} onForget={txs.forget} />
        </section>

        <section className="xc-panel xc-swap__curve" aria-label="What this withdrawal returns">
          <h2 className="xc-panel__title">What you would receive</h2>
          <dl className="xc-facts">
            <div className="xc-facts__row">
              <dt>{label0}</dt>
              <dd className="cf-num">
                {out === null ? '—' : formatUnits(out.amount0, pool.token0.decimals, 6)}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>{label1}</dt>
              <dd className="cf-num">
                {out === null ? '—' : formatUnits(out.amount1, pool.token1.decimals, 6)}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>
                You receive at least
                <span className="xc-facts__hint">
                  Below either of these the transaction reverts rather than paying out less.
                </span>
              </dt>
              <dd className="cf-num">
                {min0 === null || min1 === null
                  ? '—'
                  : `${formatUnits(min0, pool.token0.decimals, 6)} ${label0} · ${formatUnits(min1, pool.token1.decimals, 6)} ${label1}`}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>Pool tokens burned</dt>
              <dd className="cf-num">{burning === null ? '—' : formatUnits(burning, 18, 6)}</dd>
            </div>
            <div className="xc-facts__row">
              <dt>
                The token being approved
                <span className="xc-facts__hint">
                  The pool itself. A pair is an ERC-20 and the router has to be allowed to move your
                  balance of it before it can burn any.
                </span>
              </dt>
              <dd>
                <a
                  className="cf-num"
                  href={explorerAddressUrl(estate, pool.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(pool.address)}
                </a>
              </dd>
            </div>
          </dl>
          <p className="xc-panel__actions">
            <Link className="cf-btn" to={addLiquidityPath(pool.address)}>
              Add liquidity
            </Link>
            <Link className="cf-btn" to={POSITIONS_PATH}>
              Your positions
            </Link>
          </p>
        </section>
      </div>
    </div>
  )
}

/** The one next action. Order is behaviour; see `SwapAction` in `pages/swap.tsx`. */
function WithdrawAction(props: {
  readonly busy: 'approve' | 'remove' | null
  readonly available: boolean
  readonly connecting: boolean
  readonly connected: boolean
  readonly wrongChain: boolean
  readonly chainName: string
  readonly hasPosition: boolean
  readonly computed: boolean
  readonly needsApproval: boolean
  readonly onConnect: () => void
  readonly onSwitch: () => void
  readonly onApprove: () => void
  readonly onRemove: () => void
}) {
  if (!props.available) {
    return (
      <p className="xc-action__none">
        No wallet is installed in this browser, so nothing here can be signed. The pool&rsquo;s own
        numbers above are still real and still readable without one.
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
  if (!props.hasPosition) {
    return <p className="xc-action__none">There is nothing of yours in this pool to withdraw.</p>
  }
  if (props.needsApproval) {
    return (
      <button
        type="button"
        className="cf-btn cf-btn--ember xc-action"
        onClick={props.onApprove}
        disabled={props.busy !== null}
      >
        {props.busy === 'approve'
          ? 'Waiting for the wallet…'
          : 'Allow the router to burn your pool tokens'}
      </button>
    )
  }
  return (
    <button
      type="button"
      className="cf-btn cf-btn--ember xc-action"
      onClick={props.onRemove}
      disabled={props.busy !== null || !props.computed}
    >
      {props.busy === 'remove' ? 'Waiting for the wallet…' : 'Remove liquidity'}
    </button>
  )
}
