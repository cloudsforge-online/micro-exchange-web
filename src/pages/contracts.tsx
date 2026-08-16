/**
 * The addresses, and the checks — RE-RUN IN THE READER'S BROWSER.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THIS PAGE IS THE ONE THAT MAKES THE REST OF THE SURFACE CHECKABLE.
 *
 * Every other page here asks to be believed about something: that this contract is the router, that
 * this price came from that pool, that nobody is taking a cut. Those are exactly the claims a
 * convincing fake makes too. So this page does not assert them — it performs them, live, from the
 * bundle already running in the reader's browser, and prints BOTH SIDES of every comparison so the
 * reader can see the two strings rather than a green tick somebody chose to render.
 *
 * ── THE TWO CHECKS THE PLAN CALLS TRAPS ───────────────────────────────────────────────────────
 *
 *   TRAP 1 — THE INIT-CODE HASH. The V2 router derives a pair's address with CREATE2 from a
 *   hard-coded `INIT_CODE_HASH`. A fork that recompiled `UniswapV2Pair` — a different compiler
 *   version is enough — and did not update that constant produces a router whose every swap is sent
 *   to an address with no code at it. `factory.getPair()` still answers correctly, so nothing looks
 *   wrong until the first real trade reverts. This page hashes nothing on trust: it asks the factory
 *   for its own `pairCodeHash`, compares it with the constant this bundle was built with, and then
 *   independently DERIVES a live pair's address from that constant and compares the result with the
 *   factory's own `getPair()`. Two comparisons, because the first one catches a wrong constant and
 *   the second catches a wrong derivation.
 *
 *   TRAP 2 — THE FEE SWITCH. `feeTo` being the zero address is what makes "the 0.3% stays in the
 *   pool" true, and `feeToSetter` is the address that can change that at any moment without asking
 *   anybody. Both are printed. A surface that said "no protocol fee" without naming who can start
 *   charging one would be telling a truth with a shape that misleads.
 *
 * ── WHY IT HAS ITS OWN ADDRESS ────────────────────────────────────────────────────────────────
 *
 * This is the page somebody links to when they are asked to prove the thing is real, and a section
 * of a swap form is not linkable. `/contracts` is in `ROUTES`, in the router, and in nginx.conf.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { Link } from 'react-router-dom'
import type { CloudsForgeHosts } from '@cloudsforge/ui'
import { Check, Side } from '../components/checks.tsx'
import { Failed, Loading, NoEndpoint, NoExchange } from '../components/states.tsx'
import { useChain } from '../lib/chain.tsx'
import { pairFor, type Deployment } from '../lib/dex.ts'
import { formatCount } from '../lib/format.ts'
import { explorerAddressUrl, hosts } from '../lib/hosts.ts'
import {
  readFactoryFacts,
  readPair,
  readPairAddress,
  readPairAt,
  readPairCount,
  readRouterFacts,
  type TokenMeta,
} from '../lib/market.ts'
import { useResource } from '../lib/resource.ts'
import { poolPath } from '../lib/routes.ts'

const ZERO = '0x0000000000000000000000000000000000000000'

export function ContractsPage() {
  const chain = useChain()
  if (chain.status === 'unknown') return <Loading label="Finding the chain" />
  if (chain.status === 'unreachable') return <NoEndpoint />
  if (chain.status === 'no-exchange' || chain.deployment === null) {
    return <NoExchange chainId={chain.chainId} />
  }
  return <Contracts deployment={chain.deployment} />
}

/** A pair to run the derivation against, plus both answers for it. */
interface Sample {
  readonly address: string
  readonly token0: TokenMeta
  readonly token1: TokenMeta
  readonly derived: string
  readonly fromFactory: string | null
}

interface Proof {
  readonly factory: Awaited<ReturnType<typeof readFactoryFacts>>
  readonly router: Awaited<ReturnType<typeof readRouterFacts>>
  readonly pairCount: number | null
  readonly sample: Sample | null
}

/**
 * Every read this page makes, in one function.
 *
 * The sample pair is the factory's own first — `allPairs(0)` — rather than one named here, because
 * a hard-coded pair address would be one more thing this bundle asserts. Whichever market was
 * created first is a fact about the chain, and it is the one pair guaranteed to exist wherever the
 * factory has ever been used.
 */
async function readProof(deployment: Deployment): Promise<Proof | null> {
  const [factory, router, pairCount] = await Promise.all([
    readFactoryFacts(deployment),
    readRouterFacts(deployment),
    readPairCount(deployment),
  ])

  /*
    NOTHING CAME BACK, SO THERE IS NOTHING TO REPORT — and `null` is how that is said.

    Every field here is independently nullable, and the checks below are written to render each
    unknown as "Not answered", which is right when one read failed among five. It is NOT right when
    all of them failed: a page that renders four unknowns has told the reader the checks were run
    and came back empty, when in fact the node never answered. `Failed` says the other thing —
    "a fault in the reading, not a finding about the contracts" — and it can only render if this
    returns null, because `useResource` marks a read failed on null and on nothing else.

    Checked as "every one of them" rather than "any of them": a chain where the router genuinely
    has no `WETH()` is a real deployment fault worth showing four checks about, and failing the
    whole page for it would hide the finding behind an outage message.
  */
  const answered =
    factory.pairCodeHash !== null ||
    factory.feeTo !== null ||
    factory.feeToSetter !== null ||
    router.factory !== null ||
    router.wrapped !== null ||
    pairCount !== null
  if (!answered) return null

  let sample: Sample | null = null
  if (pairCount !== null && pairCount > 0) {
    const first = await readPairAt(deployment, 0)
    const view = first === null ? null : await readPair(deployment, first)
    if (view !== null) {
      sample = {
        address: view.address,
        token0: view.token0,
        token1: view.token1,
        derived: pairFor(deployment, view.token0.address, view.token1.address).toLowerCase(),
        fromFactory: (
          await readPairAddress(deployment, view.token0.address, view.token1.address)
        )?.toLowerCase() ?? null,
      }
    }
  }

  return { factory, router, pairCount, sample }
}

function Contracts({ deployment }: { readonly deployment: Deployment }) {
  const estate = hosts()
  const proof = useResource(() => readProof(deployment), [deployment.chainId])

  return (
    <div className="xc-page">
      <header className="xc-page__head">
        <h1 className="xc-title">The contracts</h1>
        <p className="xc-lede">
          Forge Exchange is four contracts on {deployment.chainName}, chain{' '}
          <span className="cf-num">{deployment.chainId}</span>. Nobody at CloudsForge can pause
          them, take from them or upgrade them. Below are their addresses and, underneath, the
          checks that say so — run in this browser, against the chain, each time this page loads.
        </p>
      </header>

      <section className="xc-panel" aria-labelledby="xc-addresses">
        <h2 className="xc-panel__title" id="xc-addresses">
          Addresses
        </h2>
        <table className="xc-table">
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Address</th>
              <th scope="col" className="xc-table__num">
                Deployed at block
              </th>
            </tr>
          </thead>
          <tbody>
            <AddressRow
              estate={estate}
              name="Factory"
              what="Creates pairs, one per pair of tokens, and keeps the list."
              address={deployment.factory}
              block={deployment.blocks.factory}
            />
            <AddressRow
              estate={estate}
              name="Router"
              what="The only contract this surface ever asks you to sign for. Holds nothing between transactions."
              address={deployment.router}
              block={deployment.blocks.router}
            />
            <AddressRow
              estate={estate}
              name={`Wrapped ${deployment.nativeSymbol}`}
              what={`${deployment.nativeSymbol} as an ERC-20, so it can sit in a pool. One in, one out, always.`}
              address={deployment.wrapped}
              block={deployment.blocks.wrapped}
            />
            {deployment.multicall !== null && (
              <AddressRow
                estate={estate}
                name="Multicall3"
                what="Batches reads into one request. Never signed for; it cannot move anything."
                address={deployment.multicall}
                block={deployment.blocks.multicall}
              />
            )}
          </tbody>
        </table>
      </section>

      {proof.state === 'loading' && <Loading label="Running the checks" />}
      {proof.state === 'failed' && (
        <Failed
          title="The checks could not be run"
          hint="The chain node did not answer, so nothing below could be verified. That is a fault in the reading, not a finding about the contracts."
          onRetry={proof.reload}
        />
      )}
      {proof.data !== null && proof.state !== 'loading' && (
        <Checks deployment={deployment} proof={proof.data} estate={estate} />
      )}
    </div>
  )
}

function AddressRow({
  estate,
  name,
  what,
  address,
  block,
}: {
  readonly estate: CloudsForgeHosts
  readonly name: string
  readonly what: string
  readonly address: string
  readonly block: number | null
}) {
  return (
    <tr>
      <th scope="row" className="xc-table__market">
        {name}
        <span className="xc-table__what">{what}</span>
      </th>
      <td>
        <a
          className="cf-num xc-facts__wrap"
          href={explorerAddressUrl(estate, address)}
          target="_blank"
          rel="noreferrer"
        >
          {address}
        </a>
      </td>
      <td className="xc-table__num cf-num">{block === null ? '—' : formatCount(block)}</td>
    </tr>
  )
}

function Checks({
  deployment,
  proof,
  estate,
}: {
  readonly deployment: Deployment
  readonly proof: Proof
  readonly estate: CloudsForgeHosts
}) {
  const { factory, router, sample } = proof
  const hashMatches =
    factory.pairCodeHash !== null &&
    factory.pairCodeHash.toLowerCase() === deployment.initCodeHash.toLowerCase()
  const derivationMatches =
    sample !== null && sample.fromFactory !== null && sample.derived === sample.fromFactory
  const routerFactoryMatches =
    router.factory !== null && router.factory.toLowerCase() === deployment.factory.toLowerCase()
  const routerWrappedMatches =
    router.wrapped !== null && router.wrapped.toLowerCase() === deployment.wrapped.toLowerCase()
  const feeOff = factory.feeTo !== null && factory.feeTo.toLowerCase() === ZERO

  return (
    <section className="xc-panel" aria-labelledby="xc-checks">
      <h2 className="xc-panel__title" id="xc-checks">
        The checks
      </h2>
      <p className="xc-panel__note">
        Each of these was just run against the chain. Both sides of every comparison are printed, so
        nothing here has to be taken on the word of this page.
      </p>

      <ol className="xc-checks">
        <Check
          n={1}
          question="Does the factory's pair code hash match the one this page derives addresses from?"
          verdict={hashMatches ? 'match' : factory.pairCodeHash === null ? 'unknown' : 'differ'}
          why="If these differ, every address the router computes for a swap points at an address with no contract at it, and every trade reverts. It is the failure that a working-looking factory hides."
        >
          <Side label="The factory says" value={factory.pairCodeHash} />
          <Side label="This page uses" value={deployment.initCodeHash} />
        </Check>

        <Check
          n={2}
          question="Deriving a real pair's address here — does it come out where the factory says it is?"
          verdict={
            sample === null ? 'unknown' : derivationMatches ? 'match' : 'differ'
          }
          why="The address is computed in this browser with CREATE2 from the factory address, the two token addresses and the hash above — the same arithmetic the router does — and then asked of the factory separately. Agreement means the derivation the router relies on is sound on this chain."
        >
          {sample === null ? (
            <p className="xc-check__none">
              The factory has not created a pair yet, so there is nothing to derive. This check runs
              itself the moment one exists.
            </p>
          ) : (
            <>
              <p className="xc-check__subject">
                Derived for{' '}
                <span className="xc-check__pair">
                  {sample.token0.symbol ?? 'token 0'} <span aria-hidden="true">·</span>{' '}
                  {sample.token1.symbol ?? 'token 1'}
                </span>
                , the first market this factory made —{' '}
                <Link to={poolPath(sample.address)}>see the pool</Link>.
              </p>
              <Side label="Derived in this browser" value={sample.derived} />
              <Side label="The factory answers" value={sample.fromFactory} />
            </>
          )}
        </Check>

        <Check
          n={3}
          question="Does the router point at this factory and this wrapped coin?"
          verdict={
            router.factory === null || router.wrapped === null
              ? 'unknown'
              : routerFactoryMatches && routerWrappedMatches
                ? 'match'
                : 'differ'
          }
          why="A router pointed at a different factory would quote against pools other than the ones listed here, and one pointed at a different wrapped coin would unwrap into a token you did not mean to hold."
        >
          <Side label="Router's factory" value={router.factory} />
          <Side label="Listed above" value={deployment.factory} />
          <Side label={`Router's wrapped ${deployment.nativeSymbol}`} value={router.wrapped} />
          <Side label="Listed above" value={deployment.wrapped} />
        </Check>

        <Check
          n={4}
          question="Is the protocol fee switch off?"
          verdict={factory.feeTo === null ? 'unknown' : feeOff ? 'off' : 'on'}
          why="With feeTo at the zero address, the whole 0.3% a trade pays stays in the pool and belongs to the people who supplied it. Any other address means a share is being sent there instead."
        >
          <Side label="feeTo" value={factory.feeTo} />
          {/*
            THREE OUTCOMES, NOT TWO. `feeOff` is false both when a fee is being taken and when the
            call did not come back, and a two-way ternary renders the second as the first — an
            unreachable node producing the sentence "a protocol fee is being taken", which is a
            claim about the contracts made on the strength of no evidence at all. The unknown case
            gets its own sentence and does not go on to say what the fee setter could change.
          */}
          <p className="xc-check__subject">
            {factory.feeTo === null ? (
              'The factory did not answer, so this page cannot say whether a fee is being taken.'
            ) : (
              <>
                {feeOff
                  ? 'No protocol fee is being taken.'
                  : 'A protocol fee is being taken and sent to the address above.'}{' '}
                The address below can change that at any time, without notice and without asking
                anyone.
              </>
            )}
          </p>
          <Side label="feeToSetter" value={factory.feeToSetter} link={estate} />
        </Check>
      </ol>

      <p className="xc-note">
        Every number above comes from a public node over <span className="cf-num">eth_call</span>.
        Anyone can make the same calls without this page —{' '}
        <a href={explorerAddressUrl(estate, deployment.factory)} target="_blank" rel="noreferrer">
          the explorer
        </a>{' '}
        shows the same contracts, and reading them there rather than here is a better check than any
        this page can perform on itself.
      </p>
    </section>
  )
}

/*
  `Check`, `Side` and the verdict vocabulary used to live here — this page is where the idiom was
  invented — and now live in `components/checks.tsx` because `pages/receipts.tsx` makes the same
  kind of claim and a second copy would drift into a second voice.
*/
