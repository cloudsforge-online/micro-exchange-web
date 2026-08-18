/**
 * Putting two tokens into a pool.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE THING THIS PAGE EXISTS TO SAY IS WHICH OF TWO COMPLETELY DIFFERENT ACTS IS HAPPENING.
 *
 * Depositing into a pool that already has reserves is bounded and reversible: the ratio is fixed by
 * the pool, the router refuses to move it, and the worst ordinary outcome is impermanent loss,
 * which a withdrawal undoes as far as the market allows.
 *
 * Depositing into an EMPTY pool is not that. There is no ratio to conform to, so the ratio
 * deposited becomes the price, and nothing anywhere puts it back — the first trade takes the
 * difference, out of the depositor. It is the only place on this surface where a typo costs a large
 * fraction of what was put in. So the empty case gets a warning at the point of signing, in prose,
 * with the price the deposit is about to declare printed beside it (`FIRST_DEPOSIT_WARNING`).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── THE COUNTER-AMOUNT IS COMPUTED HERE, AND IT IS NOT THE FILL ──────────────────────────────
 *
 * Typing into one side fills the other from `quote()` — the reserves' own ratio, in this browser,
 * with no round trip. That is deliberate and it is the opposite of what `swap.tsx` does, because
 * the two numbers are not the same kind of thing. A swap quote is a FILL: the router computes it
 * and the reader receives exactly it, so it is read from the router. A deposit's counter-amount is
 * not a fill at all — `_addLiquidity` recomputes it from the reserves in the block it executes in
 * and takes whatever is consistent. Asking the node per keystroke would produce a number that is
 * just as provisional, one round trip later. The numbers that BIND are `amountAMin`/`amountBMin`,
 * and those are computed from the tolerance and shown.
 *
 * ── THE NATIVE COIN IS OFFERED WHEREVER THE POOL HOLDS THE WRAPPED ONE ───────────────────────
 *
 * A reader holds EMBER, not WEMBER, and a page that demanded the wrapped form would send them off
 * to wrap it by hand for no reason: `addLiquidityETH` exists precisely for this. So a side whose
 * token is `deployment.wrapped` gets a chooser, defaulted to the native coin, and the choice
 * decides which router entry point is built. Nothing here uses a sentinel address.
 *
 * ── NOT GATED ────────────────────────────────────────────────────────────────────────────────
 *
 * A reader with no wallet sees the pool, the arithmetic, the warning and the terms. What they
 * cannot do is sign, and the button says that rather than the page refusing to render.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Limits, DEFAULT_DEADLINE_MINUTES, DEFAULT_TOLERANCE_BPS } from '../components/limits.tsx'
import { Failed, Loading, NoEndpoint, NoExchange } from '../components/states.tsx'
import { Transactions } from '../components/transactions.tsx'
import { isAddress } from '../lib/abi.ts'
import { useChain } from '../lib/chain.tsx'
import {
  liquidityMinted,
  MINIMUM_LIQUIDITY,
  minimumOut,
  quote,
  shareBps,
  type Deployment,
} from '../lib/dex.ts'
import {
  FIRST_DEPOSIT_WARNING,
  formatBps,
  formatPrice,
  formatUnits,
  LIQUIDITY_TERMS,
  parseUnits,
  toDecimalString,
} from '../lib/format.ts'
import { hosts } from '../lib/hosts.ts'
import {
  readAllowance,
  readBalance,
  readFactoryFacts,
  readPair,
  type PairView,
  type TokenMeta,
} from '../lib/market.ts'
import { balance as readNativeBalance } from '../lib/rpc.ts'
import { useResource } from '../lib/resource.ts'
import { poolPath, POSITIONS_PATH, removeLiquidityPath } from '../lib/routes.ts'
import { useTransactions } from '../lib/tx.ts'
import { useWalletAddress } from '../lib/usewallet.tsx'
import {
  buildAddLiquidityTransaction,
  buildApproveTransaction,
  getProvider,
  isUserRejection,
  sendTransaction,
} from '../lib/wallet.ts'

export function AddLiquidityPage() {
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
          Liquidity is supplied to one market, identified by its own contract address.{' '}
          <Link to="/pools">The pools</Link> page lists every one on this chain.
        </p>
      </div>
    )
  }
  return <AddLiquidityConsole deployment={chain.deployment} address={pair.toLowerCase()} />
}

function AddLiquidityConsole({
  deployment,
  address,
}: {
  readonly deployment: Deployment
  readonly address: string
}) {
  const estate = hosts()
  const wallet = useWalletAddress()
  const provider = useMemo(() => getProvider(), [])

  const view = useResource(() => readPair(deployment, address), [deployment.chainId, address])
  const pool = view.data

  // ── A RE-READ MUST NOT UNMOUNT THE FORM, AND A TEST CAUGHT THIS ─────────────────────────────
  //
  // `useResource` re-enters `loading` on every `reload()`, and `useTransactions` calls one the
  // moment a deposit stops being pending — that is the whole point of `onSettled`. Guarding on the
  // STATE alone therefore swapped this form for a spinner at exactly the moment the reader's
  // deposit was confirmed, and took the confirmation, the transaction list, the amounts they typed
  // and their tolerance with it. The page then re-mounted saying "enter both amounts", with no
  // record anywhere that anything had happened.
  //
  // What decides is whether this pool has EVER been read. A refresh keeps the form and updates the
  // numbers under it; a failed refresh nulls the data, so the failure below still renders.
  if (pool === null && view.state === 'loading') return <Loading label="Reading the pool" />
  if (pool === null) {
    return (
      <Failed
        title="Nothing at this address answered as a pool"
        hint="The contract at this address did not return reserves. It may not be a Forge Exchange pair, or the node may be briefly unreachable."
        onRetry={view.reload}
      />
    )
  }
  return (
    <DepositForm
      deployment={deployment}
      pool={pool}
      wallet={wallet}
      provider={provider}
      estate={estate}
      onReload={view.reload}
    />
  )
}

/**
 * The form.
 *
 * Split from the read above so that every hook below runs against a pool that EXISTS. A form whose
 * hooks are declared before the `pool === null` guard is a form whose dependency arrays are full of
 * optional chaining, and the first thing that goes wrong in one of those is a balance read against
 * `undefined` that quietly answers for the zero address.
 */
function DepositForm({
  deployment,
  pool,
  wallet,
  provider,
  estate,
  onReload,
}: {
  readonly deployment: Deployment
  readonly pool: PairView
  readonly wallet: ReturnType<typeof useWalletAddress>
  readonly provider: ReturnType<typeof getProvider>
  readonly estate: ReturnType<typeof hosts>
  readonly onReload: () => void
}) {
  const wrapped = deployment.wrapped.toLowerCase()
  const wrappedSide0 = pool.token0.address === wrapped
  const wrappedSide1 = pool.token1.address === wrapped

  /* -- what the reader chose ---------------------------------------------------------------- */

  // Defaulted to the native coin on whichever side the pool holds the wrapped one, because that is
  // the balance a reader actually has.
  const [native0, setNative0] = useState(wrappedSide0)
  const [native1, setNative1] = useState(wrappedSide1)
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [toleranceBps, setToleranceBps] = useState(DEFAULT_TOLERANCE_BPS)
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEFAULT_DEADLINE_MINUTES)

  const reserve0 = pool.reserves.reserve0
  const reserve1 = pool.reserves.reserve1
  const supply = pool.reserves.totalSupply
  // "Empty" is three conditions and all three have to hold, because a pair in any other
  // combination is one whose state could not be read consistently and is not a pool to seed.
  const empty = reserve0 === 0n && reserve1 === 0n && supply !== null && supply === 0n
  const seeded = reserve0 > 0n && reserve1 > 0n && supply !== null && supply > 0n

  const parsed0 = parseUnits(amount0, pool.token0.decimals)
  const parsed1 = parseUnits(amount1, pool.token1.decimals)

  /**
   * Typing on one side fills the other, at the pool's own ratio.
   *
   * Only when the pool is seeded. On an empty pool the two sides are independent by definition —
   * that is what "you are setting the price" means — and a page that auto-filled one from the other
   * would be inventing the very ratio it is warning the reader they are choosing.
   */
  const type0 = useCallback(
    (text: string) => {
      setAmount0(text)
      if (!seeded) return
      const value = parseUnits(text, pool.token0.decimals)
      if (value === null) return
      const other = quote(value, reserve0, reserve1)
      setAmount1(other === null ? '' : toDecimalString(other, pool.token1.decimals))
    },
    [seeded, reserve0, reserve1, pool.token0.decimals, pool.token1.decimals],
  )
  const type1 = useCallback(
    (text: string) => {
      setAmount1(text)
      if (!seeded) return
      const value = parseUnits(text, pool.token1.decimals)
      if (value === null) return
      const other = quote(value, reserve1, reserve0)
      setAmount0(other === null ? '' : toDecimalString(other, pool.token0.decimals))
    },
    [seeded, reserve0, reserve1, pool.token0.decimals, pool.token1.decimals],
  )

  /* -- what the reader holds, and what the router may move ---------------------------------- */

  const owner = wallet.address
  const holdings = useResource(
    async () => {
      if (owner === null) return null
      const [a, b] = await Promise.all([
        native0 ? readNativeBalance(owner) : readBalance(pool.token0.address, owner),
        native1 ? readNativeBalance(owner) : readBalance(pool.token1.address, owner),
      ])
      return { a, b }
    },
    [owner, deployment.chainId, pool.address, native0, native1],
    { enabled: owner !== null },
  )

  const allowances = useResource(
    async () => {
      if (owner === null) return null
      const [a, b] = await Promise.all([
        native0
          ? Promise.resolve(null)
          : readAllowance(pool.token0.address, owner, deployment.router),
        native1
          ? Promise.resolve(null)
          : readAllowance(pool.token1.address, owner, deployment.router),
      ])
      return { a, b }
    },
    [owner, deployment.chainId, pool.address, native0, native1, deployment.router],
    { enabled: owner !== null },
  )

  /**
   * The factory's fee switch, read live rather than claimed.
   *
   * `feeTo` being the zero address is what "the whole 0.3% belongs to liquidity providers" means,
   * and it is a value a multisig can change in one transaction. A page that told a prospective
   * provider their return was untouched, from a constant in a bundle, would keep telling them that
   * after it stopped being true. So it is read, and both answers are rendered as sentences.
   */
  const facts = useResource(() => readFactoryFacts(deployment), [deployment.chainId])
  const protocolFeeOn =
    facts.data?.feeTo != null && !/^0x0{40}$/.test(facts.data.feeTo)

  /* -- the arithmetic ----------------------------------------------------------------------- */

  const minted =
    parsed0 === null || parsed1 === null || supply === null
      ? null
      : liquidityMinted({
          amount0: parsed0,
          amount1: parsed1,
          reserve0,
          reserve1,
          totalSupply: supply,
        })
  // The supply AFTER this mint, which is what the reader's share is a share of. On a first deposit
  // the pair also mints `MINIMUM_LIQUIDITY` to the zero address, so the new provider's share is
  // very slightly under 100% and the page should not round it up to a round number.
  const supplyAfter =
    minted === null || supply === null
      ? null
      : supply === 0n
        ? minted + MINIMUM_LIQUIDITY
        : supply + minted
  const share = minted === null || supplyAfter === null ? null : shareBps(minted, supplyAfter)

  const min0 = parsed0 === null ? null : minimumOut(parsed0, toleranceBps)
  const min1 = parsed1 === null ? null : minimumOut(parsed1, toleranceBps)

  // The price this deposit would declare, on an empty pool. Printed beside the warning, because
  // "check both amounts" is advice and a price is a thing somebody can recognise as wrong.
  const declaredPrice =
    empty && parsed0 !== null && parsed1 !== null
      ? formatPrice(parsed1, pool.token1.decimals, parsed0, pool.token0.decimals)
      : null

  /* -- signing ------------------------------------------------------------------------------ */

  const txs = useTransactions(
    useCallback(() => {
      onReload()
      holdings.reload()
      allowances.reload()
    }, [onReload, holdings.reload, allowances.reload]),
  )
  const [busy, setBusy] = useState<'approve0' | 'approve1' | 'deposit' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const send = useCallback(
    async (what: 'approve0' | 'approve1' | 'deposit') => {
      if (provider === null || owner === null) return
      setBusy(what)
      setProblem(null)
      try {
        if (what === 'deposit') {
          if (parsed0 === null || parsed1 === null || min0 === null || min1 === null) return
          const hash = await sendTransaction(
            provider,
            buildAddLiquidityTransaction({
              router: deployment.router,
              tokenA: pool.token0.address,
              tokenB: pool.token1.address,
              amountADesired: parsed0,
              amountBDesired: parsed1,
              amountAMin: min0,
              amountBMin: min1,
              from: owner,
              nowSeconds: Math.floor(Date.now() / 1000),
              aNative: native0,
              bNative: native1,
              deadlineSeconds: deadlineMinutes * 60,
            }),
          )
          txs.track('Deposit', hash)
          setAmount0('')
          setAmount1('')
        } else {
          const side0 = what === 'approve0'
          const amount = side0 ? parsed0 : parsed1
          if (amount === null) return
          const hash = await sendTransaction(
            provider,
            buildApproveTransaction({
              token: side0 ? pool.token0.address : pool.token1.address,
              spender: deployment.router,
              amount,
              from: owner,
            }),
          )
          txs.track('Approval', hash)
        }
      } catch (err: unknown) {
        // Declining is a decision, not a failure. Everything else gets the wallet's own message,
        // which is written for a reader and — unlike a caught `fetch` error — carries no URL.
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
      parsed0,
      parsed1,
      min0,
      min1,
      native0,
      native1,
      deadlineMinutes,
      deployment.router,
      pool.token0.address,
      pool.token1.address,
      txs.track,
    ],
  )

  /* -- render ------------------------------------------------------------------------------- */

  const label0 = sideLabel(pool.token0, native0, deployment.nativeSymbol)
  const label1 = sideLabel(pool.token1, native1, deployment.nativeSymbol)
  const wrongChain = wallet.chainId !== null && wallet.chainId !== deployment.chainId
  const short0 = holdings.data?.a != null && parsed0 !== null && holdings.data.a < parsed0
  const short1 = holdings.data?.b != null && parsed1 !== null && holdings.data.b < parsed1
  const approve0 =
    !native0 && parsed0 !== null && allowances.data?.a != null && allowances.data.a < parsed0
  const approve1 =
    !native1 && parsed1 !== null && allowances.data?.b != null && allowances.data.b < parsed1

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <p className="xc-eyebrow">
          <Link to={poolPath(pool.address)}>
            {pool.token0.symbol ?? 'token 0'} · {pool.token1.symbol ?? 'token 1'}
          </Link>
        </p>
        <h1 className="xc-title">Add liquidity</h1>
        <p className="xc-lede">
          Put both tokens into this pool and receive a share of it. The share is an ERC-20 the pool
          mints; it is a claim on a proportion of whatever the pool holds when you take it back out,
          which is not the two amounts you put in.
        </p>
      </header>

      <div className="xc-swap">
        <section className="xc-panel xc-swap__form" aria-label="Add liquidity">
          <SideField
            token={pool.token0}
            label={label0}
            amount={amount0}
            onAmount={type0}
            native={native0}
            onNative={setNative0}
            wrappedHere={wrappedSide0}
            nativeSymbol={deployment.nativeSymbol}
            held={holdings.data?.a ?? null}
            connected={wallet.address !== null}
            reading={holdings.state === 'loading'}
          />
          <p className="xc-deposit__plus" aria-hidden="true">
            +
          </p>
          <SideField
            token={pool.token1}
            label={label1}
            amount={amount1}
            onAmount={type1}
            native={native1}
            onNative={setNative1}
            wrappedHere={wrappedSide1}
            nativeSymbol={deployment.nativeSymbol}
            held={holdings.data?.b ?? null}
            connected={wallet.address !== null}
            reading={holdings.state === 'loading'}
          />

          {empty && (
            <p className="xc-warning" role="alert">
              <strong>This is the first deposit.</strong> {FIRST_DEPOSIT_WARNING}
              {declaredPrice !== null && (
                <>
                  {' '}
                  At the amounts above the price would be{' '}
                  <span className="cf-num">{declaredPrice}</span> {label1} per {label0}.
                </>
              )}
            </p>
          )}

          <Limits
            group="add"
            toleranceBps={toleranceBps}
            onTolerance={setToleranceBps}
            deadlineMinutes={deadlineMinutes}
            onDeadline={setDeadlineMinutes}
            toleranceHint={
              'How far the pool’s ratio may move, because of somebody else’s trade, before this ' +
              'deposit should revert instead of going in at a ratio you did not choose.'
            }
          />

          <DepositAction
            busy={busy}
            available={wallet.available}
            connecting={wallet.connecting}
            connected={wallet.address !== null}
            wrongChain={wrongChain}
            chainName={deployment.chainName}
            amountsInvalid={
              (amount0.trim() !== '' && parsed0 === null) ||
              (amount1.trim() !== '' && parsed1 === null)
            }
            hasAmounts={parsed0 !== null && parsed0 > 0n && parsed1 !== null && parsed1 > 0n}
            short={short0 ? label0 : short1 ? label1 : null}
            approveLabel={approve0 ? label0 : approve1 ? label1 : null}
            mintable={minted !== null}
            onConnect={wallet.connect}
            onSwitch={() => void wallet.requestChain(deployment.chainId)}
            onApprove={() => void send(approve0 ? 'approve0' : 'approve1')}
            onDeposit={() => void send('deposit')}
          />

          {problem !== null && (
            <p className="xc-problem" role="alert">
              {problem}
            </p>
          )}
          <Transactions transactions={txs.transactions} estate={estate} onForget={txs.forget} />
        </section>

        <section className="xc-panel xc-swap__curve" aria-label="What this deposit is worth">
          <h2 className="xc-panel__title">What you would receive</h2>
          <dl className="xc-facts">
            <div className="xc-facts__row">
              <dt>
                Pool tokens minted
                <span className="xc-facts__hint">
                  An estimate, computed here from the reserves above. The pair mints against the
                  balances it finds in the block it executes in, so a trade in between moves this.
                </span>
              </dt>
              <dd className="cf-num">{minted === null ? '—' : formatUnits(minted, 18, 6)}</dd>
            </div>
            <div className="xc-facts__row">
              <dt>Your share of the pool afterwards</dt>
              <dd className="cf-num">{formatBps(share)}</dd>
            </div>
            <div className="xc-facts__row">
              <dt>
                You deposit at least
                <span className="xc-facts__hint">
                  Below either of these the transaction reverts rather than depositing.
                </span>
              </dt>
              <dd className="cf-num">
                {min0 === null || min1 === null
                  ? '—'
                  : `${formatUnits(min0, pool.token0.decimals, 6)} ${label0} · ${formatUnits(min1, pool.token1.decimals, 6)} ${label1}`}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>Pool holds now</dt>
              <dd className="cf-num">
                {formatUnits(reserve0, pool.token0.decimals, 4)} {label0} ·{' '}
                {formatUnits(reserve1, pool.token1.decimals, 4)} {label1}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>
                Protocol fee switch
                <span className="xc-facts__hint">
                  Read from the factory just now. When it is on, one sixth of the 0.3% is minted to
                  its beneficiary instead of accruing to the pool, and the address that controls it
                  can turn it on at any time without asking anybody here.
                </span>
              </dt>
              <dd>
                {facts.state === 'loading'
                  ? '…'
                  : facts.data?.feeTo == null
                    ? 'could not be read'
                    : protocolFeeOn
                      ? 'ON — part of the fee goes elsewhere'
                      : 'off — the whole 0.3% stays in the pool'}
              </dd>
            </div>
          </dl>
          <p className="xc-panel__actions">
            <Link className="cf-btn" to={removeLiquidityPath(pool.address)}>
              Remove liquidity
            </Link>
            <Link className="cf-btn" to={POSITIONS_PATH}>
              Your positions
            </Link>
          </p>
        </section>
      </div>

      <section className="xc-terms" aria-label="What you are agreeing to">
        <h2 className="xc-terms__title">Before you press it</h2>
        <dl className="xc-terms__list">
          {LIQUIDITY_TERMS.map((term) => (
            <div className="xc-terms__item" key={term.what}>
              <dt className="xc-terms__what">{term.what}</dt>
              <dd className="xc-terms__detail">{term.detail}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

/** What to call one side: the native coin when that is what is being deposited, else the token. */
function sideLabel(token: TokenMeta, native: boolean, nativeSymbol: string): string {
  if (native) return nativeSymbol
  return token.symbol ?? 'token'
}

/**
 * One side of the deposit.
 *
 * The wrapped side carries a chooser rather than a checkbox, so both options are visible at once —
 * a reader who holds WEMBER (because they wrapped some for a swap) and a reader who holds only
 * EMBER are looking at the same control and can see which one they are about to spend.
 */
function SideField({
  token,
  label,
  amount,
  onAmount,
  native,
  onNative,
  wrappedHere,
  nativeSymbol,
  held,
  connected,
  reading,
}: {
  readonly token: TokenMeta
  readonly label: string
  readonly amount: string
  readonly onAmount: (text: string) => void
  readonly native: boolean
  readonly onNative: (native: boolean) => void
  readonly wrappedHere: boolean
  readonly nativeSymbol: string
  readonly held: bigint | null
  readonly connected: boolean
  readonly reading: boolean
}) {
  const wrappedSymbol = token.symbol ?? 'wrapped'
  return (
    <label className="xc-field">
      <span className="xc-field__label">Deposit</span>
      <span className="xc-field__row">
        <input
          className="cf-input cf-input--mono xc-field__amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.0"
          value={amount}
          aria-label={`Amount of ${label} to deposit`}
          onChange={(e) => onAmount(e.target.value)}
        />
        {wrappedHere ? (
          <select
            className="cf-select xc-field__token"
            value={native ? 'native' : 'wrapped'}
            aria-label={`Which form of ${nativeSymbol} to deposit`}
            onChange={(e) => onNative(e.target.value === 'native')}
          >
            <option value="native">{nativeSymbol}</option>
            <option value="wrapped">{wrappedSymbol}</option>
          </select>
        ) : (
          <span className="cf-select xc-field__token xc-field__token--fixed">{label}</span>
        )}
      </span>
      <span className="xc-field__note">
        {!connected ? (
          'Connect a wallet to see your balance.'
        ) : reading ? (
          'Reading your balance…'
        ) : held === null ? (
          'Your balance could not be read.'
        ) : (
          <>
            You hold{' '}
            <button
              type="button"
              className="xc-linkish"
              onClick={() => onAmount(toDecimalString(held, token.decimals))}
            >
              <span className="cf-num">{formatUnits(held, token.decimals, 6)}</span> {label}
            </button>
          </>
        )}
        {token.decimalsAssumed && ' This token would not say how many decimals it has; 18 is assumed.'}
      </span>
    </label>
  )
}

/**
 * The one next action.
 *
 * Its own component for the same reason `SwapAction` is: the ORDER of these branches is the
 * behaviour. "Deposit" must never be reachable above "wrong network", and a chain of ternaries
 * inside the form is where that ordering gets edited by accident.
 */
function DepositAction(props: {
  readonly busy: 'approve0' | 'approve1' | 'deposit' | null
  readonly available: boolean
  readonly connecting: boolean
  readonly connected: boolean
  readonly wrongChain: boolean
  readonly chainName: string
  readonly amountsInvalid: boolean
  readonly hasAmounts: boolean
  readonly short: string | null
  readonly approveLabel: string | null
  readonly mintable: boolean
  readonly onConnect: () => void
  readonly onSwitch: () => void
  readonly onApprove: () => void
  readonly onDeposit: () => void
}) {
  if (!props.available) {
    return (
      <p className="xc-action__none">
        No wallet is installed in this browser, so nothing here can be signed. Every number on this
        page is still real and still readable without one.
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
  if (props.amountsInvalid) {
    return (
      <p className="xc-action__none">That amount has more decimal places than the token has.</p>
    )
  }
  if (!props.hasAmounts) {
    return (
      <button type="button" className="cf-btn cf-btn--ember xc-action" disabled>
        Enter both amounts
      </button>
    )
  }
  if (props.short !== null) {
    return (
      <button type="button" className="cf-btn cf-btn--ember xc-action" disabled>
        You do not hold that much {props.short}
      </button>
    )
  }
  if (props.approveLabel !== null) {
    return (
      <button
        type="button"
        className="cf-btn cf-btn--ember xc-action"
        onClick={props.onApprove}
        disabled={props.busy !== null}
      >
        {props.busy === 'approve0' || props.busy === 'approve1'
          ? 'Waiting for the wallet…'
          : `Allow the router to move this ${props.approveLabel}`}
      </button>
    )
  }
  if (!props.mintable) {
    return (
      <p className="xc-action__none">
        Those amounts would mint no pool tokens at all, and the pair would refuse the deposit. Try
        larger ones.
      </p>
    )
  }
  return (
    <button
      type="button"
      className="cf-btn cf-btn--ember xc-action"
      onClick={props.onDeposit}
      disabled={props.busy !== null}
    >
      {props.busy === 'deposit' ? 'Waiting for the wallet…' : 'Add liquidity'}
    </button>
  )
}
