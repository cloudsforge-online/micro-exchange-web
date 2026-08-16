/**
 * Every market the factory has made.
 *
 * ── THE QUESTION THIS PAGE ANSWERS THAT THE SWAP FORM CANNOT ──────────────────────────────────
 *
 * "Is there a market for X." A form that has already been given two tokens is the wrong place to
 * find that out, and a select box full of symbols is the wrong shape for it too — a symbol on a
 * permissionless factory is a string somebody chose, and two tokens may share one. So this page
 * lists POOLS, keyed by the pair's own address, with what each one holds.
 *
 * ── IT DOES NOT RANK THEM, AND THAT IS A DECISION ─────────────────────────────────────────────
 *
 * The order is the factory's own `allPairs` index — creation order, which is a fact about the
 * chain rather than an opinion about the tokens. Sorting by "liquidity" would need a common unit
 * to compare two pools of unrelated tokens in, and this surface has no price oracle and no
 * business inventing one. A table that appeared to rank markets by size would be making exactly
 * the recommendation the footer says CloudsForge is not making.
 *
 * ── THE TRUNCATION IS ON SCREEN ───────────────────────────────────────────────────────────────
 *
 * `readAllPairs` reads at most `PAIR_PAGE_LIMIT` and returns the factory's own total alongside, so
 * the caption can say "50 of 128" rather than implying that fifty is all there is. A silent cap
 * reads as completeness, which is the wrong thing to tell somebody looking for a market that is
 * not in the first fifty.
 */
import { Link } from 'react-router-dom'
import type { CloudsForgeHosts } from '@cloudsforge/ui'
import { Empty, Failed, Loading, NoEndpoint, NoExchange } from '../components/states.tsx'
import { useChain } from '../lib/chain.tsx'
import { PAIR_PAGE_LIMIT, readAllPairs, type PairView } from '../lib/market.ts'
import { formatCount, formatPrice, formatUnits, shortAddress } from '../lib/format.ts'
import { explorerAddressUrl, hosts } from '../lib/hosts.ts'
import { useResource } from '../lib/resource.ts'
import { poolPath, swapPath } from '../lib/routes.ts'
import type { Deployment } from '../lib/dex.ts'

export function PoolsPage() {
  const chain = useChain()
  if (chain.status === 'unknown') return <Loading label="Finding the chain" />
  if (chain.status === 'unreachable') return <NoEndpoint />
  if (chain.status === 'no-exchange' || chain.deployment === null) {
    return <NoExchange chainId={chain.chainId} />
  }
  return <PoolList deployment={chain.deployment} />
}

function PoolList({ deployment }: { readonly deployment: Deployment }) {
  const estate = hosts()
  const markets = useResource(() => readAllPairs(deployment), [deployment.chainId], {
    count: (r) => r.pairs.length,
  })

  if (markets.state === 'loading') return <Loading label="Reading the factory" />
  if (markets.state === 'failed') {
    return <Failed title="The factory did not answer" onRetry={markets.reload} />
  }

  const pairs = markets.data?.pairs ?? []
  const total = markets.data?.total ?? null

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <h1 className="xc-title">Pools</h1>
        <p className="xc-lede">
          Every market the factory on {deployment.chainName} has created, in the order it created
          them. Each one is a contract holding two tokens; the ratio between them is the price, and
          nothing else sets it.
        </p>
      </header>

      {pairs.length === 0 ? (
        <Empty
          title="The factory has not created a market yet"
          hint="Nothing is wrong. A pool exists the moment somebody creates one and puts two tokens in it — this page lists them as they appear."
          action={
            <Link className="cf-btn" to="/contracts">
              See the contracts
            </Link>
          }
        />
      ) : (
        <>
          <table className="xc-table">
            <caption className="xc-table__caption">
              {total !== null && total > pairs.length ? (
                <>
                  The first <span className="cf-num">{formatCount(pairs.length)}</span> of{' '}
                  <span className="cf-num">{formatCount(total)}</span> pools. This page reads at
                  most {PAIR_PAGE_LIMIT}.
                </>
              ) : (
                <>
                  <span className="cf-num">{formatCount(pairs.length)}</span>{' '}
                  {pairs.length === 1 ? 'pool' : 'pools'} on this chain.
                </>
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col" className="xc-table__num">
                  Holds
                </th>
                <th scope="col" className="xc-table__num">
                  Price
                </th>
                <th scope="col">Pair address</th>
                <th scope="col">
                  <span className="cf-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((pair) => (
                <PoolRow key={pair.address} pair={pair} estate={estate} />
              ))}
            </tbody>
          </table>
          <p className="xc-note">
            A pool appearing here is not a recommendation. Anyone may create a market for any token,
            including a token that does nothing, and the factory does not check what it is given.
            <Link to="/contracts"> The contracts page</Link> shows how to verify a pair address for
            yourself.
          </p>
        </>
      )}
    </div>
  )
}

function PoolRow({
  pair,
  estate,
}: {
  readonly pair: PairView
  readonly estate: CloudsForgeHosts
}) {
  const label0 = pair.token0.symbol ?? shortAddress(pair.token0.address)
  const label1 = pair.token1.symbol ?? shortAddress(pair.token1.address)
  const price = formatPrice(
    pair.reserves.reserve1,
    pair.token1.decimals,
    pair.reserves.reserve0,
    pair.token0.decimals,
  )

  return (
    <tr>
      <th scope="row" className="xc-table__market">
        <Link to={poolPath(pair.address)}>
          {label0} <span aria-hidden="true">·</span> {label1}
        </Link>
      </th>
      <td className="xc-table__num">
        <span className="cf-num">
          {formatUnits(pair.reserves.reserve0, pair.token0.decimals, 2)}
        </span>{' '}
        {label0}
        <br />
        <span className="cf-num">
          {formatUnits(pair.reserves.reserve1, pair.token1.decimals, 2)}
        </span>{' '}
        {label1}
      </td>
      <td className="xc-table__num">
        {price === null ? (
          <span className="xc-table__none">no price</span>
        ) : (
          <>
            <span className="cf-num">{price}</span>{' '}
            <span className="xc-table__unit">
              {label1}/{label0}
            </span>
          </>
        )}
      </td>
      <td>
        <a
          className="cf-num"
          href={explorerAddressUrl(estate, pair.address)}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddress(pair.address)}
        </a>
      </td>
      <td>
        <Link className="cf-btn" to={swapPath(pair.token0.address, pair.token1.address)}>
          Swap
        </Link>
      </td>
    </tr>
  )
}
