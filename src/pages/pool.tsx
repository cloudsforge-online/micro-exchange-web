/**
 * One market, at its own address.
 *
 * This page exists because a pair address is the only durable identity a market has. Two tokens may
 * share a symbol, a token may change its symbol, and a "market" named by a pair of tickers is a
 * link that starts meaning something different one day. The address does not move.
 *
 * ── IT DERIVES ITS OWN ADDRESS AND SHOWS THE WORKING ──────────────────────────────────────────
 *
 * `pairFor()` recomputes the address from the two tokens with CREATE2 — the same derivation the
 * router does — and the page prints whether it matches the address in the URL. A reader who
 * arrived from a link they were sent can therefore check, in their own browser, that the contract
 * they are looking at is the one the factory would have made for those two tokens, rather than
 * some other contract that answers `getReserves()` plausibly. That is trap 1 of the plan applied
 * to a single market; `contracts.tsx` applies it to the deployment as a whole.
 *
 * ── THE INVARIANT IS PRINTED, NOT JUST PLOTTED ────────────────────────────────────────────────
 *
 * `k` is the number the whole design rests on, and it is the one number that says whether a swap
 * was honest: it must never fall. It is on screen in full, unrounded, because a rounded invariant
 * is not an invariant anybody can check.
 */
import { Link, useParams } from 'react-router-dom'
import { InvariantCurve } from '../components/curve.tsx'
import { Failed, Loading, NoEndpoint, NoExchange } from '../components/states.tsx'
import { isAddress } from '../lib/abi.ts'
import { useChain } from '../lib/chain.tsx'
import { pairFor, type Deployment } from '../lib/dex.ts'
import { formatPrice, formatUnits } from '../lib/format.ts'
import { explorerAddressUrl, hosts } from '../lib/hosts.ts'
import { readPair } from '../lib/market.ts'
import { useResource } from '../lib/resource.ts'
import { swapPath } from '../lib/routes.ts'

export function PoolPage() {
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
          A pool is identified by a twenty-byte contract address. <Link to="/pools">The pools</Link>{' '}
          page lists every one on this chain.
        </p>
      </div>
    )
  }
  return <PoolDetail deployment={chain.deployment} address={pair.toLowerCase()} />
}

function PoolDetail({
  deployment,
  address,
}: {
  readonly deployment: Deployment
  readonly address: string
}) {
  const estate = hosts()
  const view = useResource(() => readPair(deployment, address), [deployment.chainId, address])

  if (view.state === 'loading') return <Loading label="Reading the pool" />
  if (view.state === 'failed' || view.data === null) {
    return (
      <Failed
        title="Nothing at this address answered as a pool"
        hint="The contract at this address did not return reserves. It may not be a Forge Exchange pair, or the node may be briefly unreachable."
        onRetry={view.reload}
      />
    )
  }

  const pool = view.data
  const label0 = pool.token0.symbol ?? 'token 0'
  const label1 = pool.token1.symbol ?? 'token 1'
  // The check: what the factory WOULD have made for these two tokens, derived here rather than
  // asked for. Matching means this contract is the canonical pair for this pair of tokens.
  const derived = pairFor(deployment, pool.token0.address, pool.token1.address)
  const canonical = derived.toLowerCase() === pool.address.toLowerCase()
  const price = formatPrice(
    pool.reserves.reserve1,
    pool.token1.decimals,
    pool.reserves.reserve0,
    pool.token0.decimals,
  )

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <p className="xc-eyebrow">
          <Link to="/pools">Pools</Link>
        </p>
        <h1 className="xc-title">
          {label0} <span aria-hidden="true">·</span> {label1}
        </h1>
        <p className="xc-lede">
          A contract holding two tokens on {deployment.chainName}. Everything below is read from it
          directly.
        </p>
      </header>

      <div className="xc-detail">
        <section className="xc-panel xc-detail__curve" aria-label="The pool's curve">
          <h2 className="xc-panel__title">The invariant</h2>
          <InvariantCurve
            reserveIn={pool.reserves.reserve0}
            reserveOut={pool.reserves.reserve1}
            decimalsIn={pool.token0.decimals}
            decimalsOut={pool.token1.decimals}
            symbolIn={label0}
            symbolOut={label1}
          />
          <p className="xc-panel__note">
            Every point on that line is a pair of reserves with the same product. Trading moves the
            pool along it; supplying or withdrawing liquidity moves it to a different line.
          </p>
        </section>

        <section className="xc-panel xc-detail__facts" aria-label="What this pool holds">
          <h2 className="xc-panel__title">What it holds</h2>
          <dl className="xc-facts">
            <div className="xc-facts__row">
              <dt>{label0}</dt>
              <dd className="cf-num">
                {formatUnits(pool.reserves.reserve0, pool.token0.decimals, 6)}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>{label1}</dt>
              <dd className="cf-num">
                {formatUnits(pool.reserves.reserve1, pool.token1.decimals, 6)}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>Price</dt>
              <dd className="cf-num">
                {price === null ? '—' : `${price} ${label1} per ${label0}`}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>
                k, the invariant
                <span className="xc-facts__hint">
                  reserve<sub>0</sub> × reserve<sub>1</sub>, in smallest units. It must never fall.
                </span>
              </dt>
              <dd className="cf-num xc-facts__wrap">{pool.reserves.k.toString()}</dd>
            </div>
            <div className="xc-facts__row">
              <dt>Liquidity tokens issued</dt>
              <dd className="cf-num">
                {pool.reserves.totalSupply === null
                  ? '—'
                  : formatUnits(pool.reserves.totalSupply, 18, 6)}
              </dd>
            </div>
          </dl>

          <h2 className="xc-panel__title">The addresses</h2>
          <dl className="xc-facts">
            <div className="xc-facts__row">
              <dt>This pair</dt>
              <dd>
                <a
                  className="cf-num xc-facts__wrap"
                  href={explorerAddressUrl(estate, pool.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {pool.address}
                </a>
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>{label0}</dt>
              <dd>
                <a
                  className="cf-num xc-facts__wrap"
                  href={explorerAddressUrl(estate, pool.token0.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {pool.token0.address}
                </a>
                {pool.token0.decimalsAssumed && (
                  <span className="xc-facts__hint">
                    This token would not say how many decimals it has; 18 is assumed above.
                  </span>
                )}
              </dd>
            </div>
            <div className="xc-facts__row">
              <dt>{label1}</dt>
              <dd>
                <a
                  className="cf-num xc-facts__wrap"
                  href={explorerAddressUrl(estate, pool.token1.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {pool.token1.address}
                </a>
                {pool.token1.decimalsAssumed && (
                  <span className="xc-facts__hint">
                    This token would not say how many decimals it has; 18 is assumed above.
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {/*
            The derivation, stated as a result rather than as a reassurance. A page that only ever
            printed "verified ✓" would be making a claim; this prints the address it derived, so a
            reader can compare the two strings themselves.
          */}
          <p className={canonical ? 'xc-verdict xc-verdict--ok' : 'xc-verdict xc-verdict--off'}>
            {canonical ? (
              <>
                This is the canonical pair for these two tokens. Deriving it in this browser from
                the factory address and the pair init-code hash produces the same address.
              </>
            ) : (
              <>
                This contract is <strong>not</strong> the address the factory&rsquo;s own derivation
                produces for these two tokens, which is{' '}
                <span className="cf-num xc-facts__wrap">{derived}</span>. Treat it with suspicion.
              </>
            )}
          </p>

          <p className="xc-panel__actions">
            <Link
              className="cf-btn cf-btn--ember"
              to={swapPath(pool.token0.address, pool.token1.address)}
            >
              Swap this pair
            </Link>
          </p>
        </section>
      </div>

      {/*
        No "as of block N" line here: the header carries it for the whole read, and a second copy on
        one page would be a second thing to keep in step with the first.
      */}
      <p className="xc-note">
        Reserves are read when this page loads and do not follow the chain on their own. Reload to
        read them again.
      </p>
    </div>
  )
}
