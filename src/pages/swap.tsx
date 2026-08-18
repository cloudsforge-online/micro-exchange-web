/**
 * One trade, against one pool.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE FORM AND THE CURVE ARE ONE CONTROL, NOT A CONTROL AND A CHART BESIDE IT.
 *
 * Every quantity in the form has a position on the curve, and the curve is the only place a reader
 * can SEE why the number they get back is smaller than the number the price implies. So the two are
 * laid out as a single instrument — form on the left, curve on the right on a wide screen, curve
 * directly under the amount on a narrow one — and the curve redraws from the amount as it is typed.
 * `components/curve.tsx` argues why a price-history chart would have been the wrong picture here.
 *
 * The panel is a FIXED ASPECT and the page does not grow a column that stretches to the bottom of
 * the document: micro-org#145 recorded exactly that failure on Foresight, where the control a
 * reader came for ended up below the fold of a long right-hand column. The thing you act with is
 * first in document order and first in the tab order.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── IMPACT IS COMPUTED LOCALLY; THE FILL IS READ FROM THE ROUTER ──────────────────────────────
 *
 * `dex.ts` reimplements V2's arithmetic so the curve can be drawn between reads, and the number
 * shown as "you receive" comes from `getAmountsOut` on the router itself. That is the correct way
 * round for the failure: if a fee parameter ever changes on chain, the picture goes slightly wrong
 * and the quote stays right. A page that showed its own arithmetic as the quote would be confidently
 * wrong at the only moment it mattered.
 *
 * ── THE ORDER OF THE BUTTON'S LIVES ───────────────────────────────────────────────────────────
 *
 * Connect → wrong chain → approve → swap. Each is a different sentence and each replaces the
 * previous one in the same place, so the reader always has exactly one next action. There is
 * deliberately no "Approve and swap" that does both from one press: two transactions is what it
 * costs, and a button that quietly opens a second wallet prompt after the first is how people sign
 * things they did not read.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DEFAULT_TOLERANCE_BPS, TOLERANCES } from '../components/limits.tsx'
import { Failed, Loading, NoEndpoint, NoExchange } from '../components/states.tsx'
import { Transactions } from '../components/transactions.tsx'
import { InvariantCurve } from '../components/curve.tsx'
import { useChain } from '../lib/chain.tsx'
import {
  getAmountOut,
  minimumOut,
  priceImpactBps,
  type Deployment,
} from '../lib/dex.ts'
import {
  formatBps,
  formatPrice,
  formatUnits,
  parseUnits,
  SWAP_TERMS,
  shortAddress,
  toDecimalString,
} from '../lib/format.ts'
import { hosts } from '../lib/hosts.ts'
import {
  readAllowance,
  readAllPairs,
  readAmountsOut,
  readBalance,
  type PairView,
  type TokenMeta,
} from '../lib/market.ts'
import { balance as readNativeBalance } from '../lib/rpc.ts'
import { useResource } from '../lib/resource.ts'
import { poolPath } from '../lib/routes.ts'
import { useTransactions } from '../lib/tx.ts'
import { useWalletAddress } from '../lib/usewallet.tsx'
import {
  buildApproveTransaction,
  buildSwapTransaction,
  getProvider,
  isUserRejection,
  sendTransaction,
} from '../lib/wallet.ts'

/**
 * The value a `<select>` carries for the native coin.
 *
 * NOT AN ADDRESS. `lib/wallet.ts` refuses to take a sentinel address for the native side, because a
 * magic address that leaks into a path is a swap sent to a contract that is not there. This string
 * cannot be mistaken for one: it never reaches an encoder, and the code below turns it into
 * `deployment.wrapped` plus a boolean at exactly one point.
 */
const NATIVE = 'native'

export function SwapPage() {
  const chain = useChain()
  if (chain.status === 'unknown') return <Loading label="Finding the chain" />
  if (chain.status === 'unreachable') return <NoEndpoint />
  if (chain.status === 'no-exchange' || chain.deployment === null) {
    return <NoExchange chainId={chain.chainId} />
  }
  return <SwapConsole deployment={chain.deployment} />
}

function SwapConsole({ deployment }: { readonly deployment: Deployment }) {
  const estate = hosts()
  const wallet = useWalletAddress()
  const provider = useMemo(() => getProvider(), [])
  const [params, setParams] = useSearchParams()

  /* -- what markets exist ------------------------------------------------------------------- */

  const markets = useResource(
    () => readAllPairs(deployment),
    [deployment.chainId],
    { count: (r) => r.pairs.length },
  )
  const pairs: readonly PairView[] = markets.data?.pairs ?? []

  /**
   * The tradeable tokens, DERIVED FROM THE POOLS RATHER THAN LISTED.
   *
   * There is no token list in this repository and there is not going to be one. A curated list is a
   * claim about which tokens are legitimate, which is a claim CloudsForge is not in a position to
   * make about a permissionless factory — and the day it exists, the tokens left off it look
   * rejected rather than simply unlisted. What the page can honestly say is "these are the tokens
   * some pool on this chain holds", which is a fact, and it says exactly that.
   */
  const tokens = useMemo(() => {
    const byAddress = new Map<string, TokenMeta>()
    for (const pair of pairs) {
      byAddress.set(pair.token0.address, pair.token0)
      byAddress.set(pair.token1.address, pair.token1)
    }
    return [...byAddress.values()].sort((a, b) => (a.symbol ?? '').localeCompare(b.symbol ?? ''))
  }, [pairs])

  /* -- the selection ------------------------------------------------------------------------ */

  const wanted = { from: params.get('from') ?? '', to: params.get('to') ?? '' }
  const [from, setFrom] = useState<string>(wanted.from || NATIVE)
  const [to, setTo] = useState<string>(wanted.to)
  const [amount, setAmount] = useState('')
  const [toleranceBps, setToleranceBps] = useState(DEFAULT_TOLERANCE_BPS)

  // The first market that exists decides the default "to", once, when the pools arrive. Without
  // this the form opens with nothing on the other side and a reader has to guess that a second
  // choice is even required.
  useEffect(() => {
    if (to !== '' || tokens.length === 0) return
    const other = tokens.find((t) => !t.native)
    if (other) setTo(other.address)
  }, [tokens, to])

  const tokenFor = useCallback(
    (value: string): TokenMeta | null => {
      if (value === NATIVE) {
        return {
          address: deployment.wrapped,
          symbol: deployment.nativeSymbol,
          decimals: 18,
          decimalsAssumed: false,
          native: true,
        }
      }
      return tokens.find((t) => t.address === value) ?? null
    },
    [tokens, deployment],
  )

  const tokenIn = tokenFor(from)
  const tokenOut = tokenFor(to)
  const fromNative = from === NATIVE
  const toNative = to === NATIVE
  const sameAsset =
    tokenIn !== null && tokenOut !== null && tokenIn.address === tokenOut.address

  const amountIn = tokenIn === null ? null : parseUnits(amount, tokenIn.decimals)
  const path =
    tokenIn === null || tokenOut === null ? null : ([tokenIn.address, tokenOut.address] as const)

  /* -- the pool behind this pair ------------------------------------------------------------ */

  const pool = useMemo(() => {
    if (path === null) return null
    return (
      pairs.find(
        (p) =>
          (p.token0.address === path[0] && p.token1.address === path[1]) ||
          (p.token0.address === path[1] && p.token1.address === path[0]),
      ) ?? null
    )
  }, [pairs, path?.[0], path?.[1]])

  // Which side of the pool the reader is spending. A pool is the authority on its own ordering, so
  // this is read off the pool rather than assumed from the form.
  const reserveIn = pool === null || tokenIn === null
    ? null
    : pool.token0.address === tokenIn.address
      ? pool.reserves.reserve0
      : pool.reserves.reserve1
  const reserveOut = pool === null || tokenOut === null
    ? null
    : pool.token0.address === tokenOut.address
      ? pool.reserves.reserve0
      : pool.reserves.reserve1

  /* -- the quote, from the router --------------------------------------------------------- */

  const quotable = amountIn !== null && amountIn > 0n && path !== null && pool !== null && !sameAsset
  const quote = useResource(
    () =>
      quotable
        ? readAmountsOut(deployment, amountIn as bigint, path as unknown as readonly string[])
        : Promise.resolve(null),
    [deployment.chainId, String(amountIn), path?.[0], path?.[1]],
    { enabled: quotable },
  )
  const amountOut = quote.data === null ? null : (quote.data[quote.data.length - 1] ?? null)

  // The local arithmetic. It draws the picture; it never becomes the quote.
  const localOut =
    amountIn === null || reserveIn === null || reserveOut === null
      ? null
      : getAmountOut(amountIn, reserveIn, reserveOut)
  const impact =
    amountIn === null || reserveIn === null || reserveOut === null
      ? null
      : priceImpactBps(amountIn, reserveIn, reserveOut)
  const worstCase = amountOut === null ? null : minimumOut(amountOut, toleranceBps)

  /* -- what the reader holds ---------------------------------------------------------------- */

  const held = useResource(
    () =>
      wallet.address === null || tokenIn === null
        ? Promise.resolve(null)
        : fromNative
          ? readNativeBalance(wallet.address)
          : readBalance(tokenIn.address, wallet.address),
    [wallet.address, tokenIn?.address, fromNative],
    { enabled: wallet.address !== null && tokenIn !== null },
  )

  const allowance = useResource(
    () =>
      wallet.address === null || tokenIn === null || fromNative
        ? Promise.resolve(null)
        : readAllowance(tokenIn.address, wallet.address, deployment.router),
    [wallet.address, tokenIn?.address, fromNative, deployment.router],
    { enabled: wallet.address !== null && tokenIn !== null && !fromNative },
  )

  const needsApproval =
    !fromNative &&
    amountIn !== null &&
    amountIn > 0n &&
    allowance.data !== null &&
    allowance.data < amountIn

  /* -- signing ------------------------------------------------------------------------------- */

  /**
   * The transactions this page sent, followed until the chain answers.
   *
   * This replaces a `sent` state that held one hash and a link to the explorer. That shape could
   * not say whether the swap worked — and, worse, said "Swap sent" about a transaction that was
   * mined and reverted. `lib/tx.ts` carries the whole argument; the callback here is what re-reads
   * the reserves and the balance at the moment they actually changed rather than at broadcast.
   */
  const txs = useTransactions(
    useCallback(() => {
      markets.reload()
      held.reload()
      allowance.reload()
    }, [markets.reload, held.reload, allowance.reload]),
  )
  const [busy, setBusy] = useState<'approve' | 'swap' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const send = useCallback(
    async (what: 'approve' | 'swap') => {
      if (provider === null || wallet.address === null) return
      setBusy(what)
      setProblem(null)
      try {
        if (what === 'approve') {
          if (tokenIn === null || amountIn === null) return
          const hash = await sendTransaction(
            provider,
            buildApproveTransaction({
              token: tokenIn.address,
              spender: deployment.router,
              amount: amountIn,
              from: wallet.address,
            }),
          )
          txs.track('Approval', hash)
        } else {
          if (path === null || amountIn === null || worstCase === null) return
          const hash = await sendTransaction(
            provider,
            buildSwapTransaction({
              router: deployment.router,
              path: [...path],
              amountIn,
              amountOutMin: worstCase,
              from: wallet.address,
              nowSeconds: Math.floor(Date.now() / 1000),
              fromNative,
              toNative,
            }),
          )
          txs.track('Swap', hash)
          setAmount('')
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
      wallet.address,
      tokenIn,
      amountIn,
      path,
      worstCase,
      deployment,
      fromNative,
      toNative,
      txs.track,
    ],
  )

  /* -- the swap of the two sides ------------------------------------------------------------ */

  const flip = useCallback(() => {
    setFrom(to)
    setTo(from)
    setAmount('')
    setParams(
      from === NATIVE || to === NATIVE ? {} : { from: to, to: from },
      { replace: true },
    )
  }, [from, to, setParams])

  /* -- render -------------------------------------------------------------------------------- */

  if (markets.state === 'loading') return <Loading label="Reading the markets" />
  if (markets.state === 'failed') {
    return <Failed title="The markets did not load" onRetry={markets.reload} />
  }

  const wrongChain = wallet.chainId !== null && wallet.chainId !== deployment.chainId
  const insufficient =
    held.data !== null && amountIn !== null && amountIn > 0n && held.data < amountIn

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <h1 className="xc-title">Swap</h1>
        <p className="xc-lede">
          Trade against a pool on {deployment.chainName}. The price is not quoted by anybody — it is
          the ratio of what the pool holds, and your own trade moves it. Everything below is read
          from the chain.
        </p>
      </header>

      {tokens.length === 0 ? (
        <p className="xc-empty-line">
          The factory has not created a market yet, so there is nothing to trade against.{' '}
          <Link to="/pools">See the pools</Link>.
        </p>
      ) : (
        <div className="xc-swap">
          {/* -------------------------------------------------------------- the instrument */}
          <section className="xc-panel xc-swap__form" aria-label="Swap">
            <label className="xc-field">
              <span className="xc-field__label">You pay</span>
              <span className="xc-field__row">
                <input
                  className="cf-input cf-input--mono xc-field__amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.0"
                  value={amount}
                  aria-label="Amount to pay"
                  onChange={(e) => setAmount(e.target.value)}
                />
                <select
                  className="cf-select xc-field__token"
                  value={from}
                  aria-label="Token to pay with"
                  onChange={(e) => setFrom(e.target.value)}
                >
                  <option value={NATIVE}>{deployment.nativeSymbol}</option>
                  {tokens
                    .filter((t) => !t.native)
                    .map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.symbol ?? shortAddress(t.address)}
                      </option>
                    ))}
                </select>
              </span>
              <span className="xc-field__note">
                {wallet.address === null ? (
                  'Connect a wallet to see your balance.'
                ) : held.state === 'loading' ? (
                  'Reading your balance…'
                ) : held.data === null ? (
                  'Your balance could not be read.'
                ) : (
                  <>
                    You hold{' '}
                    <button
                      type="button"
                      className="xc-linkish"
                      // `toDecimalString`, not `formatUnits`: the latter groups thousands, and a
                      // balance of 1,234.5 written into this field comes back through `parseUnits`
                      // as null — the form then says "enter an amount" under an amount it put
                      // there itself.
                      onClick={() =>
                        setAmount(toDecimalString(held.data as bigint, tokenIn?.decimals ?? 18))
                      }
                    >
                      <span className="cf-num">
                        {formatUnits(held.data, tokenIn?.decimals ?? 18, 6)}
                      </span>{' '}
                      {tokenIn?.symbol ?? ''}
                    </button>
                  </>
                )}
              </span>
            </label>

            <div className="xc-flip">
              <button
                type="button"
                className="xc-flip__btn"
                onClick={flip}
                aria-label="Swap the two sides"
              >
                <span aria-hidden="true">⇅</span>
              </button>
            </div>

            <label className="xc-field">
              <span className="xc-field__label">You receive</span>
              <span className="xc-field__row">
                <output className="cf-input cf-input--mono xc-field__amount xc-field__amount--out">
                  {amountOut === null
                    ? quote.state === 'loading'
                      ? '…'
                      : '—'
                    : formatUnits(amountOut, tokenOut?.decimals ?? 18, 8)}
                </output>
                <select
                  className="cf-select xc-field__token"
                  value={to}
                  aria-label="Token to receive"
                  onChange={(e) => setTo(e.target.value)}
                >
                  <option value={NATIVE}>{deployment.nativeSymbol}</option>
                  {tokens
                    .filter((t) => !t.native)
                    .map((t) => (
                      <option key={t.address} value={t.address}>
                        {t.symbol ?? shortAddress(t.address)}
                      </option>
                    ))}
                </select>
              </span>
              <span className="xc-field__note">
                {tokenOut?.decimalsAssumed === true
                  ? 'This token would not say how many decimals it has; 18 is assumed.'
                  : 'Quoted by the router itself, at the block in the header.'}
              </span>
            </label>

            <fieldset className="xc-tolerance">
              <legend className="xc-tolerance__legend">
                Slippage tolerance
                <span className="xc-tolerance__hint">
                  How far the price may move because of somebody else&rsquo;s trade before this one
                  should fail instead of filling. It is not the same thing as the impact of your own
                  trade, which is certain and shown below.
                </span>
              </legend>
              <span className="xc-tolerance__opts">
                {TOLERANCES.map((option) => (
                  <label key={option.bps} className="xc-tolerance__opt">
                    <input
                      type="radio"
                      name="tolerance"
                      value={option.bps}
                      checked={toleranceBps === option.bps}
                      onChange={() => setToleranceBps(option.bps)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </span>
            </fieldset>

            <SwapAction
              busy={busy}
              connected={wallet.address !== null}
              available={wallet.available}
              connecting={wallet.connecting}
              wrongChain={wrongChain}
              chainName={deployment.chainName}
              needsApproval={needsApproval}
              symbolIn={tokenIn?.symbol ?? ''}
              hasPool={pool !== null}
              sameAsset={sameAsset}
              hasAmount={amountIn !== null && amountIn > 0n}
              amountInvalid={amount.trim() !== '' && amountIn === null}
              insufficient={insufficient}
              quoted={amountOut !== null}
              onConnect={wallet.connect}
              onSwitch={() => void wallet.requestChain(deployment.chainId)}
              onApprove={() => void send('approve')}
              onSwap={() => void send('swap')}
            />

            {problem !== null && (
              <p className="xc-problem" role="alert">
                {problem}
              </p>
            )}
            <Transactions transactions={txs.transactions} estate={estate} onForget={txs.forget} />
          </section>

          {/* ------------------------------------------------------------------ the picture */}
          <section className="xc-panel xc-swap__curve" aria-label="What this trade does to the pool">
            <h2 className="xc-panel__title">The pool, and where your trade lands on it</h2>
            {pool === null || reserveIn === null || reserveOut === null ? (
              <p className="xc-curve__none">
                {sameAsset
                  ? `${deployment.nativeSymbol} and its wrapped form are the same asset — the router wraps and unwraps at the boundary, so there is nothing to trade between them.`
                  : 'There is no pool for this pair. Anyone may create one; this page does not.'}
              </p>
            ) : (
              <>
                <InvariantCurve
                  reserveIn={reserveIn}
                  reserveOut={reserveOut}
                  decimalsIn={tokenIn?.decimals ?? 18}
                  decimalsOut={tokenOut?.decimals ?? 18}
                  symbolIn={tokenIn?.symbol ?? '?'}
                  symbolOut={tokenOut?.symbol ?? '?'}
                  amountIn={amountIn ?? undefined}
                  amountOut={amountOut ?? localOut ?? undefined}
                />
                <dl className="xc-facts">
                  <div className="xc-facts__row">
                    <dt>Price now</dt>
                    <dd className="cf-num">
                      {formatPrice(
                        reserveOut,
                        tokenOut?.decimals ?? 18,
                        reserveIn,
                        tokenIn?.decimals ?? 18,
                      ) ?? '—'}{' '}
                      <span className="xc-facts__unit">
                        {tokenOut?.symbol ?? ''} per {tokenIn?.symbol ?? ''}
                      </span>
                    </dd>
                  </div>
                  <div className="xc-facts__row">
                    <dt>Impact of this trade</dt>
                    <dd className="cf-num">{formatBps(impact)}</dd>
                  </div>
                  <div className="xc-facts__row">
                    <dt>Fee, kept by the pool</dt>
                    <dd className="cf-num">0.30%</dd>
                  </div>
                  <div className="xc-facts__row">
                    <dt>You get at least</dt>
                    <dd className="cf-num">
                      {worstCase === null
                        ? '—'
                        : `${formatUnits(worstCase, tokenOut?.decimals ?? 18, 6)} ${tokenOut?.symbol ?? ''}`}
                    </dd>
                  </div>
                  <div className="xc-facts__row">
                    <dt>Pool</dt>
                    <dd>
                      <Link className="cf-num" to={poolPath(pool.address)}>
                        {shortAddress(pool.address)}
                      </Link>
                    </dd>
                  </div>
                </dl>
              </>
            )}
          </section>
        </div>
      )}

      {/*
        THE THREE THINGS A READER IS AGREEING TO, AS PROSE RATHER THAN AS THREE IDENTICAL TILES.
        A hairline between entries and a term set in the display face is enough structure; boxing
        each one would make them look like three products to choose between.
      */}
      <section className="xc-terms" aria-label="What you are agreeing to">
        <h2 className="xc-terms__title">Before you press it</h2>
        <dl className="xc-terms__list">
          {SWAP_TERMS.map((term) => (
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

/**
 * The one next action, chosen from the state the reader is actually in.
 *
 * Extracted as its own component because the ORDER of these branches is the whole behaviour, and a
 * chain of ternaries inside the form would let a later edit put "Swap" above "wrong network"
 * without anybody noticing until a transaction went to the router's address on another chain.
 */
function SwapAction(props: {
  readonly busy: 'approve' | 'swap' | null
  readonly connected: boolean
  readonly available: boolean
  readonly connecting: boolean
  readonly wrongChain: boolean
  readonly chainName: string
  readonly needsApproval: boolean
  readonly symbolIn: string
  readonly hasPool: boolean
  readonly sameAsset: boolean
  readonly hasAmount: boolean
  readonly amountInvalid: boolean
  readonly insufficient: boolean
  readonly quoted: boolean
  readonly onConnect: () => void
  readonly onSwitch: () => void
  readonly onApprove: () => void
  readonly onSwap: () => void
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
  if (props.sameAsset) {
    return <p className="xc-action__none">Choose two different tokens.</p>
  }
  if (!props.hasPool) {
    return <p className="xc-action__none">There is no pool for this pair to trade against.</p>
  }
  if (props.amountInvalid) {
    return <p className="xc-action__none">That amount has more decimal places than the token has.</p>
  }
  if (!props.hasAmount) {
    return (
      <button type="button" className="cf-btn cf-btn--ember xc-action" disabled>
        Enter an amount
      </button>
    )
  }
  if (props.insufficient) {
    return (
      <button type="button" className="cf-btn cf-btn--ember xc-action" disabled>
        You do not hold that much {props.symbolIn}
      </button>
    )
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
          : `Allow the router to move this ${props.symbolIn}`}
      </button>
    )
  }
  return (
    <button
      type="button"
      className="cf-btn cf-btn--ember xc-action"
      onClick={props.onSwap}
      disabled={props.busy !== null || !props.quoted}
    >
      {props.busy === 'swap' ? 'Waiting for the wallet…' : 'Swap'}
    </button>
  )
}
