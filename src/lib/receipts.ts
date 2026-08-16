/**
 * Forge Receipts: which chains carry one, and everything this surface reads off one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * A RECEIPT IS SOMEBODY'S PROMISE, AND THIS MODULE EXISTS TO MAKE THAT PROMISE CHECKABLE.
 *
 * `WEMBER` can call its peg an accounting identity because the EMBER behind it sits inside the
 * WEMBER contract, on this chain, visible to the same EVM that mints. A Litecoin cannot be put
 * inside a Hearth contract. So a `ForgeReceipt` is backed by coins at addresses on ANOTHER chain
 * that somebody controls, and every holder is trusting that somebody — which is why the symbol is
 * `fLTC` and not `wLTC`: the `w` convention has come to mean "wrapped, therefore trustless", and
 * this is not that.
 *
 * What the contract buys is that dishonesty costs an on-chain lie with a timestamp on it. Issuance
 * reverts past the attested reserve; the attestation names the height of the underlying chain it
 * was read at; a stale one stops issuance by itself; a shortfall is recordable and announced; and
 * there is no pause, no freeze and no upgrade. `hearth/contracts/src/ForgeReceipt.sol` argues each
 * of those where they are implemented.
 *
 * THE READS BELOW ARE WHAT TURNS THAT FROM A DESIGN INTO SOMETHING A STRANGER CAN USE. The page
 * prints the issued supply beside the attested reserve, the height that reserve was read at, and
 * the addresses the contract itself publishes — so the check a reader makes is `scantxoutset` on
 * their own Litecoin node against addresses this bundle did not choose.
 *
 * ── THE TABLE IS KEYED BY `eth_chainId`, FOR `dex.ts`'s REASON ────────────────────────────────
 *
 * A chain id is the one fact that cannot lie about which contracts are in front of you. And here,
 * as there, a MISSING row is as load-bearing as a present one: chain 7411 has no receipt, and that
 * is a measurement rather than a plan — the reserve was scanned and came back zero, so the contract
 * refused to issue against it. `absenceFor()` carries that measurement, and the page renders it as
 * a finding, not as an empty state.
 *
 * ── WHY THE READS ARE HERE AND NOT IN `market.ts` ─────────────────────────────────────────────
 *
 * `dex.ts`/`market.ts` are split table-from-reads because three pages share the pair reads and each
 * assembles them differently. A receipt has one page and one shape, and splitting it in two would
 * mean a reader of either half could not see whether the numbers on screen were the ones the
 * contract exposes. `market.ts`'s rule still holds inside this file: every function is a
 * composition of `ethCall`s, nothing is cached, and null propagates rather than collapsing to zero.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import {
  decodeAddressAt,
  decodeBoolAt,
  decodeBytes32At,
  decodeStringArrayAt,
  decodeStringAt,
  decodeSymbol,
  decodeUintAt,
  encodeCall,
  SIG,
  selector,
} from './abi.ts'
import { deploymentFor } from './dex.ts'
import { ethCall } from './rpc.ts'

/** A receipt token, as this bundle knows it before the chain has said anything. */
export interface Receipt {
  /** The `ForgeReceipt` contract. Everything else on the page is read from it. */
  readonly address: string
  /**
   * What this table says it calls itself.
   *
   * Written down so the page has a name to show while the read is in flight — and then compared
   * with the contract's own `symbol()` in front of the reader, in `contracts.tsx`'s idiom of
   * printing both sides. A table that only ever agreed with itself would be a label, not a check.
   */
  readonly symbol: string
  /** The coin held off-chain, as the contract's `underlying()` should also say. */
  readonly underlying: string
  /** Where that coin lives, in words a reader can act on. */
  readonly underlyingChain: string
  /** The block this contract's code first existed in, for finding the deployment transaction. */
  readonly block: number | null
  /**
   * `issued` is a receipt meant to be held. `drill` is one deployed to walk the exit path and
   * prove it works, and it is marked as such on screen in the loudest terms the layout allows —
   * a test instrument that reads as an asset is the single most expensive thing this page could do.
   */
  readonly kind: 'issued' | 'drill'
  /** One sentence on why this contract exists, in the words its deployment was recorded in. */
  readonly what: string
  /**
   * The command a stranger runs to count the reserve themselves, with `<address>` standing in for
   * each entry the contract publishes.
   *
   * A COMMAND RATHER THAN A LINK. A block-explorer link is a third party this page would be asking
   * the reader to trust in place of us, which is the same shape of favour with a different name on
   * it. `scantxoutset` walks the UTXO set of a node the reader runs, needs no wallet, no import and
   * no index, and answers in a couple of minutes.
   */
  readonly checkWith: string | null
}

/**
 * Why a chain has no receipt — measured, dated, and reproducible.
 *
 * This is the record that stops "not yet" from doing the work of "we chose not to". On 7411 the
 * deployment script scanned the addresses custody holds Litecoin at, found nothing, and refused to
 * deploy: there was no reserve to issue against, and a receipt issued against nothing is the exact
 * thing §4 of docs/ecosystem/39 forbids.
 */
export interface Absence {
  readonly underlying: string
  readonly underlyingChain: string
  /** The height of the underlying chain the measurement was made at. */
  readonly height: number
  /** That block's hash — the reference an audit is pointed at, so the reading can be repeated. */
  readonly reference: string
  /** The day it was measured, so its age is the reader's to judge rather than ours to assert. */
  readonly measuredOn: string
  readonly checkWith: string
}

export interface ReceiptChain {
  readonly chainId: number
  readonly receipts: readonly Receipt[]
  /** Meaningful only where `receipts` is empty; null where the chain carries one. */
  readonly absence: Absence | null
}

/**
 * `scantxoutset`, the reading a stranger reproduces without us.
 *
 * It is the whole argument of this page in one line: no API of ours is involved, no index has to
 * have been built, and the answer is the unspent output set of the reader's own node. `<address>`
 * is left as a placeholder because the addresses come off the chain — see `readReceipt` — and a
 * treasury address written into this bundle would be a figure that goes stale silently the first
 * time custody rotates a key, while the contract's own list would have moved.
 */
const SCAN = (cli: string): string =>
  `${cli} scantxoutset start '[{"desc":"addr(<address>)"}]'`

/**
 * Every chain this surface knows a receipt on, and every chain it knows there is not one on.
 *
 * Both rows were read back off the node before being written here rather than copied from a
 * deployment log — docs/ecosystem/39 §5 makes that the rule, and phase G is the run that produced
 * them. The blocks are the block each address first had code in.
 */
export const RECEIPT_CHAINS: readonly ReceiptChain[] = Object.freeze([
  Object.freeze({
    chainId: 7411,
    receipts: Object.freeze([]),
    absence: Object.freeze({
      underlying: 'LTC',
      underlyingChain: 'Litecoin mainnet',
      height: 3_161_029,
      reference: '0x9173116ba259641a250352ad99dfcdf3a49a996e9cbc1cf3976c313ad1a785eb',
      measuredOn: '2026-08-16',
      checkWith: SCAN('litecoin-cli'),
    }),
  }),
  Object.freeze({
    chainId: 7412,
    receipts: Object.freeze([
      Object.freeze({
        address: '0x5ff590f4f6f29711706f485d9350666d2f8e2f02',
        symbol: 'fLTC',
        underlying: 'LTC',
        underlyingChain: 'Litecoin mainnet',
        block: 19_411,
        kind: 'issued' as const,
        what:
          'The first Forge Receipt. Its issuer is the 2-of-3 multisig, and both of the issuer ' +
          'actions it has ever taken went through a full submit, confirm and execute round. It ' +
          'holds an attested reserve of zero, so it has issued nothing — which is the contract ' +
          'working, not the page failing.',
        checkWith: SCAN('litecoin-cli'),
      }),
      Object.freeze({
        address: '0x197f3dcb648abda5b7c678af5ac4d8042fcc8e6d',
        symbol: 'dEMBER',
        underlying: 'EMBER',
        underlyingChain: 'Hearth Testnet itself',
        block: 19_386,
        kind: 'drill' as const,
        what:
          'The redemption drill, and nothing else. It exists because §4 of the plan requires the ' +
          'exit to have been walked before anything is issued rather than after — so this one was ' +
          'attested, issued, burnt by a holder, paid out for real and settled with the hash of the ' +
          'transaction that paid it. Nobody should hold one.',
        // The underlying is this chain's own coin, so the check is a balance read rather than a
        // UTXO scan — and the page says so rather than printing a Litecoin command that would not
        // apply. Null is that distinction, not a gap.
        checkWith: null,
      }),
    ]),
    absence: null,
  }),
])

/** The receipts on a chain. An empty list is an answer; see `absenceFor` for why it is empty. */
export function receiptsFor(chainId: number | null): readonly Receipt[] {
  if (chainId === null) return []
  return RECEIPT_CHAINS.find((row) => row.chainId === chainId)?.receipts ?? []
}

/**
 * Why this chain has no receipt, when this bundle knows.
 *
 * Null for a chain that has one AND for a chain nobody has measured — those are different, and the
 * page distinguishes them by whether `receiptsFor` returned anything.
 */
export function absenceFor(chainId: number | null): Absence | null {
  if (chainId === null) return null
  const row = RECEIPT_CHAINS.find((entry) => entry.chainId === chainId)
  if (row === undefined || row.receipts.length > 0) return null
  return row.absence
}

/**
 * Where the reserve addresses for an underlying ARE published on chain, when not here.
 *
 * DERIVED FROM THE TABLE RATHER THAN WRITTEN DOWN. A reader on 7411 is told there is no receipt and
 * would reasonably ask which addresses were scanned to reach that conclusion; the answer is that the
 * receipt on the other network publishes them itself, in `reserveAddresses()`, and the network
 * switcher in the header is how they get there. Writing that pointer by hand would be one more
 * thing to keep in step with a table three lines above it.
 */
export function publishedElsewhere(
  underlying: string,
  notOnChainId: number | null,
): { readonly chainId: number; readonly chainName: string; readonly receipt: Receipt } | null {
  for (const row of RECEIPT_CHAINS) {
    if (row.chainId === notOnChainId) continue
    const receipt = row.receipts.find(
      (r) => r.underlying.toLowerCase() === underlying.toLowerCase() && r.kind === 'issued',
    )
    if (receipt === undefined) continue
    const chainName = deploymentFor(row.chainId)?.chainName ?? `chain ${row.chainId}`
    return { chainId: row.chainId, chainName, receipt }
  }
  return null
}

/* ── what the chain says ───────────────────────────────────────────────────────────────────── */

/** A `bytes32` of nothing, which is what an unsettled redemption carries. */
export const NO_TXID = `0x${'0'.repeat(64)}`

/** Whether a decoded `settledTxid` names a transaction. Null in, null out — never a false. */
export function isSettled(txid: string | null): boolean | null {
  if (txid === null) return null
  return txid !== NO_TXID
}

/** One redemption, as the contract stores it. */
export interface RedemptionView {
  readonly id: number
  readonly holder: string | null
  readonly amount: bigint | null
  /** Where the holder asked for the coin. Opaque to the contract, and to this page. */
  readonly payoutAddress: string | null
  readonly requestedAt: bigint | null
  /**
   * The transaction on the underlying chain that paid it.
   *
   * All zeros means burnt and unpaid, which is a claim about the issuer and is rendered as one.
   * Null means the read did not come back, which is a claim about the node. The two must never
   * become the same pixel.
   */
  readonly settledTxid: string | null
}

/** Everything the receipts page shows about one receipt, read fresh. */
export interface ReceiptView {
  readonly address: string
  readonly symbol: string | null
  readonly name: string | null
  readonly decimals: number | null
  readonly underlying: string | null
  readonly statement: string | null
  readonly issuer: string | null
  /** From `coverage()`: the five numbers that decide whether this token is what it says it is. */
  readonly supply: bigint | null
  readonly reserve: bigint | null
  readonly height: bigint | null
  readonly attestedAt: bigint | null
  /** The contract's own `attestationIsFresh()`, judged against the chain's clock and not ours. */
  readonly fresh: boolean | null
  /** The attestation's free reference — a run id or a block hash on the underlying chain. */
  readonly reference: string | null
  readonly maxAge: bigint | null
  /** The addresses the contract publishes as holding the backing. Null is a failed read. */
  readonly addresses: readonly string[] | null
  readonly redemptionCount: number | null
  readonly redemptions: readonly RedemptionView[]
  readonly unsettledCount: bigint | null
  readonly unsettledAmount: bigint | null
}

/**
 * How many redemptions this page will read individually.
 *
 * Bounded and REPORTED, in `market.ts`'s idiom: the page shows the contract's own count beside the
 * number of rows, so a truncated list reads as a page of a longer one rather than as all there is.
 */
export const REDEMPTION_PAGE_LIMIT = 25

/**
 * One receipt, entirely.
 *
 * `null` — not a half-filled object — when NOTHING came back. Every field is independently
 * nullable and the page renders each unknown as "not answered", which is right when one read among
 * a dozen failed and wrong when the node never answered at all: a page of unknowns says the checks
 * were run and came back empty, which is a much stronger statement than "we could not ask".
 */
export async function readReceipt(receipt: Receipt): Promise<ReceiptView | null> {
  const at = receipt.address
  const [
    symbolData,
    nameData,
    decimalsData,
    underlyingData,
    statementData,
    issuerData,
    coverageData,
    attestationData,
    maxAgeData,
    addressesData,
    countData,
    unsettledData,
  ] = await Promise.all([
    ethCall(at, selector(SIG.symbol)),
    ethCall(at, selector(SIG.name)),
    ethCall(at, selector(SIG.decimals)),
    ethCall(at, selector(SIG.underlying)),
    ethCall(at, selector(SIG.issuerStatement)),
    ethCall(at, selector(SIG.issuer)),
    ethCall(at, selector(SIG.coverage)),
    ethCall(at, selector(SIG.attestation)),
    ethCall(at, selector(SIG.maxAttestationAge)),
    ethCall(at, selector(SIG.reserveAddresses)),
    ethCall(at, selector(SIG.redemptionCount)),
    ethCall(at, selector(SIG.unsettledRedemptions)),
  ])

  // `coverage()` returns five STATIC words — (supply, reserve, height, at, fresh) — so every one of
  // them is a slot index rather than an offset to follow. `attestation()` is the public getter for
  // the struct and returns four: (reserve, height, at, ref). The two overlap deliberately and are
  // both read, because `coverage` carries `attestationIsFresh()` — computed against the CHAIN's
  // clock — and only `attestation` carries the reference an audit is pointed at.
  const supply = decodeUintAt(coverageData, 0)
  const reserve = decodeUintAt(coverageData, 1)
  const height = decodeUintAt(coverageData, 2)
  const attestedAt = decodeUintAt(coverageData, 3)
  const fresh = decodeBoolAt(coverageData, 4)
  const decimals = decodeUintAt(decimalsData, 0)

  const answered =
    supply !== null ||
    reserve !== null ||
    decodeSymbol(symbolData) !== null ||
    decodeAddressAt(issuerData, 0) !== null
  if (!answered) return null

  const count = decodeUintAt(countData, 0)
  const redemptions: RedemptionView[] = []
  if (count !== null && count > 0n) {
    const shown = Number(count > BigInt(REDEMPTION_PAGE_LIMIT) ? BigInt(REDEMPTION_PAGE_LIMIT) : count)
    // The LAST `shown`, not the first. A redemption that has not been paid is the one a reader
    // needs to see, and unpaid ones are new ones; a list that filled up with the oldest would hide
    // exactly the entries it exists to expose.
    const first = Number(count) - shown
    const ids = Array.from({ length: shown }, (_, i) => first + i)
    const rows = await Promise.all(ids.map((id) => readRedemption(at, id)))
    redemptions.push(...rows)
  }

  return {
    address: at.toLowerCase(),
    symbol: decodeSymbol(symbolData),
    name: decodeStringAt(nameData, 0),
    decimals: decimals === null ? null : Number(decimals),
    underlying: decodeStringAt(underlyingData, 0),
    statement: decodeStringAt(statementData, 0),
    issuer: decodeAddressAt(issuerData, 0),
    supply,
    reserve,
    height,
    attestedAt,
    fresh,
    reference: decodeBytes32At(attestationData, 3),
    maxAge: decodeUintAt(maxAgeData, 0),
    addresses: decodeStringArrayAt(addressesData, 0),
    redemptionCount: count === null ? null : Number(count),
    redemptions,
    unsettledCount: decodeUintAt(unsettledData, 0),
    unsettledAmount: decodeUintAt(unsettledData, 1),
  }
}

/**
 * One redemption.
 *
 * ── THE TXID IS HEAD WORD 4, AND IT IS NOT THE LAST WORD ─────────────────────────────────────
 *
 * `redemption(uint256)` returns `(address, uint256, string, uint64, bytes32)`. The `string` makes
 * the return a five-word head followed by that string's own length and bytes, so the DATA ends in
 * the middle of the payout address and the last word of it is text. The deploy script read from the
 * end exactly once and printed a settled txid of `0x6338643261353264623500…` — the ASCII of the
 * last ten characters of the payout address — and reported a failure against a settlement that was
 * correct on chain. The indices below are written out with the tuple beside them for that reason.
 */
async function readRedemption(receipt: string, id: number): Promise<RedemptionView> {
  const data = await ethCall(
    receipt,
    encodeCall(SIG.redemption, [{ type: 'uint', value: BigInt(id) }]),
  )
  return {
    id,
    holder: decodeAddressAt(data, 0),
    amount: decodeUintAt(data, 1),
    payoutAddress: decodeStringAt(data, 2),
    requestedAt: decodeUintAt(data, 3),
    settledTxid: decodeBytes32At(data, 4),
  }
}
