/**
 * Receipts — the one page on this surface that is about somebody's promise rather than about code.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY OTHER PAGE HERE CAN SAY "NOBODY CAN TAKE THIS". THIS ONE CANNOT, AND SAYS SO FIRST.
 *
 * A pool holds its own tokens. WEMBER holds its own EMBER. A Forge Receipt is a token on Hearth
 * whose backing is coins on ANOTHER chain, held by CloudsForge, and no contract on this chain can
 * reach across and check. That is a custody relationship, it is the exact thing the rest of this
 * surface exists to avoid, and a page that introduced it in the same voice as the swap form would
 * be laundering the difference.
 *
 * So the order of this page is the order of the argument:
 *
 *   1. WHOSE PROMISE IT IS — read off the token itself, `issuerStatement()`, so a wallet or an
 *      explorer showing the token shows the same sentence without asking us for it.
 *   2. WHAT IS ACTUALLY THERE — the issued supply beside the attested reserve, the height of the
 *      underlying chain that reserve was read at, and how old the reading is.
 *   3. HOW TO CHECK IT WITHOUT US — the addresses the contract publishes, and the command that
 *      counts them on the reader's own node.
 *   4. WHAT HAPPENED TO EVERYONE WHO LEFT — every redemption, and whether it was paid.
 *
 * ── THE PAGE IS AS HAPPY REPORTING NOTHING AS REPORTING SOMETHING ────────────────────────────
 *
 * On Forge Network there is no receipt at all, and that is a MEASUREMENT: the reserve was scanned,
 * it came back zero, and a receipt issued against nothing is the thing docs/ecosystem/39 §4 forbids.
 * `Absence` renders that with the height it was measured at, the block hash to repeat it against,
 * and the command — not as an empty state and not as "coming soon", which would both turn a
 * deliberate refusal into an unfinished feature.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import type { CloudsForgeHosts } from '@cloudsforge/ui'
import { Check, Side } from '../components/checks.tsx'
import { Failed, Loading, NoEndpoint } from '../components/states.tsx'
import { useChain } from '../lib/chain.tsx'
import {
  formatAge,
  formatCount,
  formatDuration,
  formatUnits,
  formatUtc,
  shortAddress,
} from '../lib/format.ts'
import { explorerAddressUrl, hosts } from '../lib/hosts.ts'
import {
  absenceFor,
  isSettled,
  publishedElsewhere,
  readReceipt,
  receiptsFor,
  REDEMPTION_PAGE_LIMIT,
  type Absence,
  type Receipt,
  type ReceiptView,
} from '../lib/receipts.ts'
import { useResource } from '../lib/resource.ts'

export function ReceiptsPage() {
  const chain = useChain()
  const estate = hosts()
  if (chain.status === 'unknown') return <Loading label="Finding the chain" />
  if (chain.status === 'unreachable') return <NoEndpoint />

  const receipts = receiptsFor(chain.chainId)
  const absence = absenceFor(chain.chainId)

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <h1 className="xc-title">Receipts</h1>
        <p className="xc-lede">
          A Forge Receipt is a token on Hearth that stands for a coin held somewhere else — Litecoin
          on Litecoin. Nothing on this chain can reach the other one, so the backing is not held by a
          contract: it is held by CloudsForge, and holding a receipt means trusting CloudsForge to
          still have it. This page is where that promise is written down, measured, and left where
          anyone can check it against the other chain themselves.
        </p>
      </header>

      <aside className="xc-notice xc-notice--warn" role="note">
        <p className="xc-notice__title">This one is a promise, and the rest of this surface is not</p>
        <p className="xc-notice__body">
          Swapping on Forge Exchange never puts your coins in anyone’s hands. Holding a receipt does:
          the coin it stands for is in CloudsForge’s custody until you redeem it. What the contract
          adds is that the promise is made in public with a timestamp on it — issuance is capped by
          an attested reserve, a stale attestation stops issuance by itself, and a redemption that
          was never paid stays visible as burnt supply with nothing recorded against it. It cannot
          make the promise good. It makes breaking it a matter of record.
        </p>
      </aside>

      {receipts.length === 0 ? (
        <NoReceipts chainId={chain.chainId} absence={absence} />
      ) : (
        receipts.map((receipt) => (
          <ReceiptCard
            key={receipt.address}
            receipt={receipt}
            estate={estate}
            enabled={chain.status === 'ready' || chain.status === 'no-exchange'}
          />
        ))
      )}

      <p className="xc-note">
        Every figure on this page comes from the receipt contract itself over{' '}
        <span className="cf-num">eth_call</span>, and every reserve address comes from the
        contract’s own <span className="cf-num">reserveAddresses()</span> rather than from this
        page. Nothing about which coins are held is asserted by the bundle you are reading.
      </p>
    </div>
  )
}

/**
 * A chain with no receipt on it.
 *
 * Two different sentences depending on whether the absence was MEASURED. A chain the table has an
 * `Absence` for was scanned and came back empty; a chain it has never heard of is a chain nobody
 * has looked at, and saying "the reserve is zero" about it would be the invention this whole page
 * is written against.
 */
function NoReceipts({
  chainId,
  absence,
}: {
  readonly chainId: number | null
  readonly absence: Absence | null
}) {
  if (absence === null) {
    return (
      <section className="xc-panel">
        <h2 className="xc-panel__title">No receipt has been measured on this network</h2>
        <p className="xc-panel__note">
          This surface holds no reading for chain{' '}
          <span className="cf-num">{chainId === null ? 'unknown' : chainId}</span>. That is not a
          statement that there is nothing here — it is the absence of anyone having looked, which is
          a different thing and is worth saying as one.
        </p>
      </section>
    )
  }

  const elsewhere = publishedElsewhere(absence.underlying, chainId)

  return (
    <section className="xc-panel" aria-labelledby="xc-absence">
      <h2 className="xc-panel__title" id="xc-absence">
        There is no {absence.underlying} receipt on this network, and that was measured
      </h2>
      <p className="xc-panel__note">
        Before a receipt can be deployed, the coins backing it have to be counted. The addresses
        CloudsForge holds {absence.underlying} at were scanned on {absence.underlyingChain} and the
        total came back zero — so there was nothing to issue against, and a receipt issued against
        nothing is the one thing this design refuses to allow. No contract was deployed. Nothing is
        pending.
      </p>

      <dl className="xc-facts">
        <div className="xc-facts__row">
          <dt>
            Measured at
            <span className="xc-facts__hint">
              The height on {absence.underlyingChain} the scan was run against.
            </span>
          </dt>
          <dd className="cf-num">#{formatCount(absence.height)}</dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            That block’s hash
            <span className="xc-facts__hint">
              So the reading can be repeated against the same chain state, not a later one.
            </span>
          </dt>
          <dd className="cf-num xc-facts__wrap">{absence.reference}</dd>
        </div>
        <div className="xc-facts__row">
          <dt>Reserve found</dt>
          <dd className="cf-num">0 {absence.underlying}</dd>
        </div>
        <div className="xc-facts__row">
          <dt>Read on</dt>
          <dd className="cf-num">{absence.measuredOn}</dd>
        </div>
      </dl>

      <div className="xc-scan">
        <p className="xc-scan__intro">
          Run this against your own {absence.underlyingChain} node, once per address, and add up
          what it reports. It walks the unspent output set — no wallet, no import, no index, and
          nothing of ours in the path.
        </p>
        <code className="xc-scan__cmd cf-num">{absence.checkWith}</code>
      </div>

      {elsewhere !== null && (
        <p className="xc-note">
          The addresses themselves are not written into this page, and never will be — custody
          rotates keys and a list baked into a bundle would go stale silently. They are published on
          chain by the {elsewhere.receipt.symbol} contract on {elsewhere.chainName}, chain{' '}
          <span className="cf-num">{elsewhere.chainId}</span>, which answers{' '}
          <span className="cf-num">reserveAddresses()</span> to anyone who asks. Switch networks in
          the header above to read them there.
        </p>
      )}
    </section>
  )
}

/** One receipt: the promise, the numbers, the checks, the addresses, and everyone who left. */
function ReceiptCard({
  receipt,
  estate,
  enabled,
}: {
  readonly receipt: Receipt
  readonly estate: CloudsForgeHosts
  readonly enabled: boolean
}) {
  const view = useResource(() => readReceipt(receipt), [receipt.address], { enabled })

  return (
    <section className="xc-panel" aria-labelledby={`receipt-${receipt.address}`}>
      <header className="xc-receipt__head">
        <h2 className="xc-receipt__title" id={`receipt-${receipt.address}`}>
          {receipt.symbol}
          <span className="xc-receipt__for">
            one {receipt.symbol} stands for one {receipt.underlying} on {receipt.underlyingChain}
          </span>
        </h2>
        {/*
          THE DRILL BADGE IS NOT DECORATION. `dEMBER` exists to prove the exit path works and
          nobody should ever hold one; a test instrument that reads as an asset is the single most
          expensive thing this page could render. It is a word, in the flow of the heading, for the
          same reason every verdict on this surface is a word.
        */}
        <span
          className={`xc-receipt__kind${receipt.kind === 'drill' ? ' xc-receipt__kind--drill' : ''}`}
        >
          {receipt.kind === 'drill' ? 'Test instrument — do not hold' : 'Issued receipt'}
        </span>
      </header>

      <p className="xc-receipt__what">{receipt.what}</p>

      {view.state === 'loading' && <Loading label={`Reading ${receipt.symbol}`} />}
      {view.state === 'failed' && (
        <Failed
          title={`${receipt.symbol} could not be read`}
          hint="The chain node did not answer, so none of the figures below could be read. That is a fault in the reading, not a finding about the reserve."
          onRetry={view.reload}
        />
      )}
      {view.data !== null && view.state !== 'loading' && (
        <ReceiptBody receipt={receipt} view={view.data} estate={estate} />
      )}
    </section>
  )
}

function ReceiptBody({
  receipt,
  view,
  estate,
}: {
  readonly receipt: Receipt
  readonly view: ReceiptView
  readonly estate: CloudsForgeHosts
}) {
  // 18 IS NOT ASSUMED HERE, unlike `market.ts` for an arbitrary ERC-20. A receipt is denominated in
  // the underlying coin's own units — the contract says so and refuses to convert — and guessing
  // wrong by ten orders of magnitude on a reserve figure is not a display bug, it is a false claim
  // about how much coin exists. Null decimals renders the raw integer instead, labelled as one.
  const decimals = view.decimals
  const amount = (value: bigint | null): string => {
    if (value === null) return '—'
    if (decimals === null) return `${value.toString()} (smallest units)`
    return `${formatUnits(value, decimals, 8)} ${receipt.underlying}`
  }

  const covered =
    view.supply === null || view.reserve === null ? null : view.supply <= view.reserve
  const shortfall =
    view.supply === null || view.reserve === null || view.supply <= view.reserve
      ? null
      : view.supply - view.reserve
  const age =
    view.attestedAt === null || view.attestedAt === 0n
      ? null
      : Math.floor(Date.now() / 1000) - Number(view.attestedAt)
  const symbolAgrees =
    view.symbol !== null && view.symbol.toLowerCase() === receipt.symbol.toLowerCase()
  const underlyingAgrees =
    view.underlying !== null && view.underlying.toLowerCase() === receipt.underlying.toLowerCase()

  return (
    <>
      {view.statement !== null && (
        <blockquote className="xc-promise">
          <p className="xc-promise__quote">{view.statement}</p>
          <footer className="xc-promise__by">
            — <span className="cf-num">issuerStatement()</span>, read from the token itself. A
            wallet or an explorer showing {receipt.symbol} can show you the same sentence without
            asking CloudsForge for it.
          </footer>
        </blockquote>
      )}

      <h3 className="xc-panel__title">What the contract says it is</h3>
      <dl className="xc-facts">
        <div className="xc-facts__row">
          <dt>Contract</dt>
          <dd>
            <a
              className="cf-num xc-facts__wrap"
              href={explorerAddressUrl(estate, receipt.address)}
              target="_blank"
              rel="noreferrer"
            >
              {receipt.address}
            </a>
          </dd>
        </div>
        <div className="xc-facts__row">
          <dt>Deployed at block</dt>
          <dd className="cf-num">{receipt.block === null ? '—' : `#${formatCount(receipt.block)}`}</dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            Name and symbol
            <span className="xc-facts__hint">
              {symbolAgrees
                ? 'As the token itself reports them.'
                : 'The token reports a symbol this page did not expect — read the contract before trusting either.'}
            </span>
          </dt>
          <dd className="cf-num">
            {view.name ?? '—'} · {view.symbol ?? '—'}
          </dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            A claim on
            <span className="xc-facts__hint">
              {underlyingAgrees
                ? `Free text on chain, because no contract on Hearth can verify a claim about ${receipt.underlyingChain}.`
                : 'The contract names a different underlying from the one listed here.'}
            </span>
          </dt>
          <dd className="cf-num">{view.underlying ?? '—'}</dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            Issuer
            <span className="xc-facts__hint">
              The only address that can attest, issue or settle. There is no pause, no freeze and no
              upgrade — the issuer cannot move or destroy a holder’s balance.
            </span>
          </dt>
          <dd>
            {view.issuer === null ? (
              <span className="cf-num">—</span>
            ) : (
              <a
                className="cf-num xc-facts__wrap"
                href={explorerAddressUrl(estate, view.issuer)}
                target="_blank"
                rel="noreferrer"
              >
                {view.issuer}
              </a>
            )}
          </dd>
        </div>
      </dl>

      <h3 className="xc-panel__title">What is issued, and what is behind it</h3>
      <dl className="xc-facts">
        <div className="xc-facts__row">
          <dt>Receipts outstanding</dt>
          <dd className="cf-num">{amount(view.supply)}</dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            Attested reserve
            <span className="xc-facts__hint">
              The last figure the issuer recorded on chain for what it holds on{' '}
              {receipt.underlyingChain}.
            </span>
          </dt>
          <dd className="cf-num">{amount(view.reserve)}</dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            Read at height
            <span className="xc-facts__hint">
              On {receipt.underlyingChain}. Strictly increasing, so a favourable old reading cannot
              be replayed as a current one.
            </span>
          </dt>
          <dd className="cf-num">
            {view.height === null || view.height === 0n ? '—' : `#${formatCount(Number(view.height))}`}
          </dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            Recorded
            <span className="xc-facts__hint">
              Hearth’s own timestamp. The age is measured against your clock, not ours.
            </span>
          </dt>
          <dd className="cf-num">
            {view.attestedAt === null || view.attestedAt === 0n
              ? 'never'
              : `${formatUtc(Number(view.attestedAt))}${age === null ? '' : ` · ${formatAge(age)}`}`}
          </dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            Stops authorising issuance after
            <span className="xc-facts__hint">
              Fixed at deployment and immutable. Past this, the contract refuses to issue until a
              fresh reserve is attested.
            </span>
          </dt>
          <dd className="cf-num">
            {view.maxAge === null ? '—' : formatDuration(Number(view.maxAge))}
          </dd>
        </div>
        <div className="xc-facts__row">
          <dt>
            Attestation reference
            <span className="xc-facts__hint">
              Free text the issuer recorded beside the figure — a run id, or the hash of the block it
              was read at. Not verified on chain; it exists so an audit can be pointed at its source.
            </span>
          </dt>
          <dd className="cf-num xc-facts__wrap">{view.reference ?? '—'}</dd>
        </div>
      </dl>

      <h3 className="xc-panel__title">The checks</h3>
      <p className="xc-panel__note">
        Run against the chain when this page loaded. Both sides of each one are printed.
      </p>
      <ol className="xc-checks">
        <Check
          n={1}
          question="Is every receipt in existence covered by the attested reserve?"
          verdict={covered === null ? 'unknown' : covered ? 'covered' : 'short'}
          why="The contract refuses to issue past the attested reserve — that require is the whole product, and everything else in the contract exists to make it mean something. If these two ever cross the other way, coins have left custody without receipts being burnt, and the contract announces it on chain rather than waiting to be asked."
        >
          <Side label="Receipts outstanding" value={amount(view.supply)} />
          <Side label="Attested reserve" value={amount(view.reserve)} />
          {shortfall !== null && (
            <p className="xc-check__subject">
              Short by {amount(shortfall)}. This is the state the contract emits{' '}
              <span className="cf-num">Undercollateralised</span> for; it does not resolve itself and
              it is not a display error.
            </p>
          )}
        </Check>

        <Check
          n={2}
          question="Is that reserve figure fresh enough to authorise issuing more?"
          verdict={view.fresh === null ? 'unknown' : view.fresh ? 'fresh' : 'stale'}
          why="Freshness is judged by the contract against Hearth's own clock, not computed in this browser, so it is the same answer the issue path itself gets. Stale is not a fault — it means the reserve has not been re-counted recently and the contract will refuse to mint anything until it is. Receipts already issued are unaffected."
        >
          <Side
            label="Recorded"
            value={
              view.attestedAt === null || view.attestedAt === 0n
                ? null
                : formatUtc(Number(view.attestedAt))
            }
          />
          <Side
            label="Goes stale after"
            value={view.maxAge === null ? null : formatDuration(Number(view.maxAge))}
          />
        </Check>

        <Check
          n={3}
          question="Has everyone who redeemed actually been paid?"
          verdict={
            view.unsettledCount === null
              ? 'unknown'
              : view.redemptionCount === 0
                ? 'none'
                : view.unsettledCount === 0n
                  ? 'settled'
                  : 'owing'
          }
          why="Redeeming burns the receipt first and unconditionally, so supply falls the moment a claim is made and the book can only ever be left over-covered. What that costs the issuer is that an unpaid redemption is permanently visible as burnt supply with no settlement recorded against it — which is a much harder thing to be quiet about than a support ticket."
        >
          <Side
            label="Redemptions ever made"
            value={view.redemptionCount === null ? null : formatCount(view.redemptionCount)}
          />
          <Side
            label="Burnt and not yet paid"
            value={view.unsettledCount === null ? null : formatCount(Number(view.unsettledCount))}
          />
          {view.unsettledCount !== null && view.unsettledCount > 0n && (
            <p className="xc-check__subject">
              {amount(view.unsettledAmount)} is owed and has not been recorded as paid.
            </p>
          )}
        </Check>
      </ol>

      <h3 className="xc-panel__title">Where the backing is, and how to count it yourself</h3>
      <ReserveAddresses receipt={receipt} addresses={view.addresses} />

      <h3 className="xc-panel__title">Everyone who has redeemed</h3>
      <Redemptions receipt={receipt} view={view} amount={amount} />
    </>
  )
}

/**
 * The reserve addresses, READ FROM THE CONTRACT.
 *
 * Not a constant in this bundle, and there is a reason beyond tidiness: custody rotates keys, and
 * when it does the contract republishes the list through `setReserveAddresses`. A list written into
 * a JavaScript bundle would keep pointing at yesterday's addresses, a reader would scan them, find
 * nothing, and conclude the reserve had vanished — the page would have manufactured the exact alarm
 * it exists to prevent.
 */
function ReserveAddresses({
  receipt,
  addresses,
}: {
  readonly receipt: Receipt
  readonly addresses: readonly string[] | null
}) {
  if (addresses === null) {
    return (
      <p className="xc-panel__note">
        The contract did not answer <span className="cf-num">reserveAddresses()</span>, so this page
        has nothing to show. It will not fall back to a list of its own — a stale address printed as
        a current one is worse than no address at all.
      </p>
    )
  }
  if (addresses.length === 0) {
    return (
      <p className="xc-panel__note">
        The contract publishes no reserve addresses. With none published there is no way to check the
        backing without asking CloudsForge, which is precisely the position this design exists to
        avoid — read the attested reserve above as the issuer’s unverifiable claim that it is.
      </p>
    )
  }

  return (
    <>
      <p className="xc-panel__note">
        These come from the contract’s own <span className="cf-num">reserveAddresses()</span>. They
        are on {receipt.underlyingChain}, not on Hearth, and the explorer linked elsewhere on this
        surface cannot show them.
      </p>
      <ol className="xc-reserve">
        {addresses.map((address) => (
          <li className="xc-reserve__item cf-num" key={address}>
            {address}
          </li>
        ))}
      </ol>
      {receipt.checkWith !== null ? (
        <div className="xc-scan">
          <p className="xc-scan__intro">
            Run this on your own {receipt.underlyingChain} node, once per address above, and add up
            what it reports. Compare the total with the attested reserve. It walks the unspent output
            set — no wallet, no import, no index, and nothing of ours in the path.
          </p>
          <code className="xc-scan__cmd cf-num">{receipt.checkWith}</code>
        </div>
      ) : (
        <p className="xc-panel__note">
          The underlying here is this chain’s own coin, so the check is a balance read on the
          explorer rather than a scan of another chain’s unspent outputs.
        </p>
      )}
    </>
  )
}

function Redemptions({
  receipt,
  view,
  amount,
}: {
  readonly receipt: Receipt
  readonly view: ReceiptView
  readonly amount: (value: bigint | null) => string
}) {
  if (view.redemptionCount === null) {
    return (
      <p className="xc-panel__note">
        The contract did not answer <span className="cf-num">redemptionCount()</span>.
      </p>
    )
  }
  if (view.redemptionCount === 0) {
    return (
      <p className="xc-panel__note">
        Nobody has redeemed. With nothing issued there is nothing to redeem, so this is the expected
        state rather than an unexercised path — the exit itself was walked end to end on the drill
        contract before anything was issued anywhere.
      </p>
    )
  }

  return (
    <>
      {view.redemptionCount > REDEMPTION_PAGE_LIMIT && (
        <p className="xc-panel__note">
          Showing the {REDEMPTION_PAGE_LIMIT} most recent of {formatCount(view.redemptionCount)}. The
          newest are shown rather than the oldest, because an unpaid redemption is a recent one and a
          list that filled up with the earliest would hide exactly the rows this table exists to
          expose.
        </p>
      )}
      <table className="xc-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Holder</th>
            <th scope="col" className="xc-table__num">
              Amount
            </th>
            <th scope="col">Paid to</th>
            <th scope="col">Settled by</th>
          </tr>
        </thead>
        <tbody>
          {view.redemptions.map((row) => {
            const settled = isSettled(row.settledTxid)
            return (
              <tr key={row.id}>
                <th scope="row" className="cf-num">
                  {row.id}
                </th>
                <td className="cf-num">
                  {row.holder === null ? '—' : shortAddress(row.holder)}
                </td>
                <td className="xc-table__num cf-num">{amount(row.amount)}</td>
                <td className="cf-num xc-facts__wrap">{row.payoutAddress ?? '—'}</td>
                <td>
                  {/*
                    THE TXID IS NEVER A LINK. It names a transaction on the UNDERLYING chain, and
                    the estate's explorer only knows Hearth — a link would take a reader who is
                    checking a settlement to a page that says the transaction does not exist, which
                    is the most damaging possible false negative on this page.
                  */}
                  {settled === null ? (
                    <span className="xc-side__none">no answer</span>
                  ) : settled ? (
                    <span className="cf-num xc-facts__wrap">
                      {row.settledTxid}
                      <span className="xc-facts__hint">
                        a transaction on {receipt.underlyingChain}
                      </span>
                    </span>
                  ) : (
                    <span className="xc-owing">Burnt, not yet paid</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
