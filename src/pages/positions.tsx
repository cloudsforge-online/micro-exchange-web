/**
 * What one address holds across every pool on the chain.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THERE IS NO POSITIONS TABLE ANYWHERE, SO THIS PAGE SWEEPS THE FACTORY.
 *
 * A constant-product AMM records nothing about who supplied what. A "position" is a balance of a
 * pair contract's own ERC-20 and nothing else — no NFT, no registry, no event index. So the only
 * honest way to answer "what do I have" is to ask every pair for this address's balance, which is
 * what `readPositions` does, bounded and with the bound on screen.
 *
 * That has one consequence worth stating rather than hiding: this list is complete for the pools
 * this page read, and a chain with more markets than the limit would need the reader to look at the
 * ones beyond it themselves. The caption says which case they are in.
 *
 * ── IT IS NOT GATED AND IT IS NOT A SESSION ─────────────────────────────────────────────────
 *
 * The address comes from the reader's own wallet, or from nowhere. There is no CloudsForge account
 * involved, nothing is stored, and a reader with no wallet sees an explanation of what a position
 * is rather than a sign-in wall. Everything on this page is a public chain read: anybody could
 * compute the same list for any address.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { Link } from 'react-router-dom'
import type { CloudsForgeHosts } from '@cloudsforge/ui'
import { Empty, Failed, Loading, NoEndpoint, NoExchange } from '../components/states.tsx'
import { useChain } from '../lib/chain.tsx'
import type { Deployment } from '../lib/dex.ts'
import { formatBps, formatCount, formatUnits, shortAddress } from '../lib/format.ts'
import { explorerAddressUrl, hosts } from '../lib/hosts.ts'
import { PAIR_PAGE_LIMIT, readPositions, type Position } from '../lib/market.ts'
import { useResource } from '../lib/resource.ts'
import { addLiquidityPath, poolPath, removeLiquidityPath } from '../lib/routes.ts'
import { useWalletAddress } from '../lib/usewallet.tsx'

export function PositionsPage() {
  const chain = useChain()
  if (chain.status === 'unknown') return <Loading label="Finding the chain" />
  if (chain.status === 'unreachable') return <NoEndpoint />
  if (chain.status === 'no-exchange' || chain.deployment === null) {
    return <NoExchange chainId={chain.chainId} />
  }
  return <PositionList deployment={chain.deployment} />
}

function PositionList({ deployment }: { readonly deployment: Deployment }) {
  const estate = hosts()
  const wallet = useWalletAddress()
  const owner = wallet.address

  const held = useResource(
    () => (owner === null ? Promise.resolve(null) : readPositions(deployment, owner)),
    [owner, deployment.chainId],
    { enabled: owner !== null, count: (r) => r.positions.length },
  )

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <p className="xc-eyebrow">
          <Link to="/pools">Pools</Link>
        </p>
        <h1 className="xc-title">Your liquidity</h1>
        <p className="xc-lede">
          Every pool on {deployment.chainName} that your address holds a share of. A share is a
          balance of the pool&rsquo;s own token; what it is worth is a proportion of the two
          reserves, read just now.
        </p>
      </header>

      {owner === null ? (
        <Empty
          title="No wallet is connected"
          hint={
            wallet.available
              ? 'Connect one and this page will read every pool on the chain for your address. Nothing is stored and no CloudsForge account is involved — anybody could compute the same list for any address.'
              : 'There is no wallet in this browser to read an address from. This page needs one only to know whose balances to look up; it never asks it to sign anything.'
          }
          action={
            wallet.available ? (
              <button type="button" className="cf-btn cf-btn--ember" onClick={wallet.connect}>
                {wallet.connecting ? 'Waiting for the wallet…' : 'Connect a wallet'}
              </button>
            ) : (
              <Link className="cf-btn" to="/pools">
                See the pools
              </Link>
            )
          }
        />
      ) : held.state === 'loading' ? (
        <Loading label="Reading every pool for your address" />
      ) : held.state === 'failed' ? (
        <Failed
          title="The factory did not answer"
          hint="Without the factory's own list there is no set of pools to check your balance in. Nothing was sent and nothing was signed."
          onRetry={held.reload}
        />
      ) : held.data === null || held.data.positions.length === 0 ? (
        <Empty
          title="You do not hold a share of any pool on this chain"
          hint={`Nothing is wrong. Supplying liquidity means putting both of a pool's tokens in and receiving a share of it; the fees on every trade accrue to that share. ${
            held.data === null
              ? ''
              : `Checked ${formatCount(held.data.scanned)} of ${formatCount(held.data.total)} pools.`
          }`}
          action={
            <Link className="cf-btn" to="/pools">
              See the pools
            </Link>
          }
        />
      ) : (
        <>
          <table className="xc-table">
            <caption className="xc-table__caption">
              {held.data.total > held.data.scanned ? (
                <>
                  <span className="cf-num">{formatCount(held.data.positions.length)}</span>{' '}
                  {held.data.positions.length === 1 ? 'position' : 'positions'}, among the first{' '}
                  <span className="cf-num">{formatCount(held.data.scanned)}</span> of{' '}
                  <span className="cf-num">{formatCount(held.data.total)}</span> pools. This page
                  reads at most {PAIR_PAGE_LIMIT}.
                </>
              ) : (
                <>
                  <span className="cf-num">{formatCount(held.data.positions.length)}</span>{' '}
                  {held.data.positions.length === 1 ? 'position' : 'positions'}, across every pool
                  on this chain.
                </>
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">Market</th>
                <th scope="col" className="xc-table__num">
                  Your share
                </th>
                <th scope="col" className="xc-table__num">
                  Worth now
                </th>
                <th scope="col">Pair address</th>
                <th scope="col">
                  <span className="cf-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {held.data.positions.map((position) => (
                <PositionRow
                  key={position.pair.address}
                  position={position}
                  estate={estate}
                />
              ))}
            </tbody>
          </table>
          <p className="xc-note">
            &ldquo;Worth now&rdquo; is what these pool tokens would return if they were burned
            against the reserves at the block in the header. It is not what was deposited: trading
            changes the mix, so a pool whose price has moved returns more of the side that fell.
          </p>
        </>
      )}
    </div>
  )
}

function PositionRow({
  position,
  estate,
}: {
  readonly position: Position
  readonly estate: CloudsForgeHosts
}) {
  const { pair } = position
  const label0 = pair.token0.symbol ?? shortAddress(pair.token0.address)
  const label1 = pair.token1.symbol ?? shortAddress(pair.token1.address)

  return (
    <tr>
      <th scope="row" className="xc-table__market">
        <Link to={poolPath(pair.address)}>
          {label0} <span aria-hidden="true">·</span> {label1}
        </Link>
      </th>
      <td className="xc-table__num">
        <span className="cf-num">{formatBps(position.shareBps)}</span>
        <br />
        <span className="xc-table__unit">
          <span className="cf-num">{formatUnits(position.liquidity, 18, 6)}</span> pool tokens
        </span>
      </td>
      <td className="xc-table__num">
        {position.amount0 === null || position.amount1 === null ? (
          <span className="xc-table__none">could not be read</span>
        ) : (
          <>
            <span className="cf-num">
              {formatUnits(position.amount0, pair.token0.decimals, 4)}
            </span>{' '}
            {label0}
            <br />
            <span className="cf-num">
              {formatUnits(position.amount1, pair.token1.decimals, 4)}
            </span>{' '}
            {label1}
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
      <td className="xc-table__actions">
        <Link className="cf-btn" to={addLiquidityPath(pair.address)}>
          Add
        </Link>{' '}
        <Link className="cf-btn" to={removeLiquidityPath(pair.address)}>
          Remove
        </Link>
      </td>
    </tr>
  )
}
