/**
 * The exact bytes this surface would ask a wallet to sign.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * THE PAYLOAD IS THE ONLY PART WORTH TESTING, AND IT IS THE PART A PROVIDER STUB HIDES.
 *
 * A test that injects a fake `window.ethereum`, presses a button and asserts the promise resolved
 * has proved the plumbing. The plumbing is not what moves somebody's coins to an address — the
 * calldata is. So `lib/wallet.ts`'s builders are pure functions of their arguments, and this file
 * asserts the `to`, the `data`, the `value` and the `from` word by word.
 *
 * Word by word, and not against a fixture string. A golden hex blob would be re-derived by whoever
 * broke it, from the same misunderstanding that broke it — so every expectation below is assembled
 * from `selector()` and `encodeUint`/`encodeAddress`, which is the ABI rule stated rather than a
 * previous run's output recorded.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ── THE FOUR MISTAKES THESE EXIST TO CATCH ───────────────────────────────────────────────────
 *
 * All four are transactions that SUCCEED, which is why none of them would be found by a person
 * clicking the button on testnet and seeing it go through:
 *
 *   1. `addLiquidityETH` built with the arguments in form order rather than router order. The
 *      router takes (token, tokenDesired, tokenMin, ethMin); a form whose native side is on the
 *      left and which passes its own order deposits the smaller of the two amounts on each side and
 *      does not revert.
 *   2. A native amount sent as an ARGUMENT as well as as `value`, or as neither. There is no
 *      `amountIn` on the ETH entry points — the value is the amount — and a builder that also
 *      encodes it shifts every argument after it.
 *   3. A `deadline` of `type(uint256).max`, which passes the router's `require` forever and throws
 *      away the whole protection the argument exists for.
 *   4. A minimum larger than the desired amount, which is a guaranteed revert the reader pays gas
 *      for. That one is refused rather than encoded.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeAddress, encodeUint, SIG, selector } from '../src/lib/abi.ts'
import {
  buildAddLiquidityTransaction,
  buildApproveTransaction,
  buildCreatePairTransaction,
  buildRemoveLiquidityTransaction,
  buildSwapTransaction,
  DEADLINE_CHOICES,
  DEADLINE_SECONDS,
  MAX_DEADLINE_SECONDS,
  toQuantity,
  WalletError,
} from '../src/lib/wallet.ts'

const ROUTER = '0x1111111111111111111111111111111111111111'
const FACTORY = '0x2222222222222222222222222222222222222222'
const TOKEN = '0x3333333333333333333333333333333333333333'
const WRAPPED = '0x4444444444444444444444444444444444444444'
const ME = '0x5555555555555555555555555555555555555555'
const ZERO = `0x${'0'.repeat(40)}`

/** A fixed clock. Not `Date.now()`: a builder with a hidden input cannot be asserted against. */
const NOW = 1_700_000_000
const ONE = 10n ** 18n

/** The 32-byte words of a call's arguments, after the selector. */
function words(data: string): string[] {
  const bare = data.slice(10)
  const out: string[] = []
  for (let i = 0; i < bare.length; i += 64) out.push(bare.slice(i, i + 64))
  return out
}

test('EVERY BUILDER RETURNS A value FIELD, EVEN WHEN IT IS ZERO', () => {
  // An absent `value` is not the same as `0x0` to every wallet, and the difference is a field the
  // reader is shown. `0x0` is also the minimal quantity form the JSON-RPC spec requires — `0x00`
  // and `0x` are both wrong, and both are what a naive `toString(16)` padding produces.
  assert.equal(toQuantity(0n), '0x0')
  assert.equal(toQuantity(1n), '0x1')
  assert.equal(toQuantity(255n), '0xff')
  assert.equal(toQuantity(ONE), '0xde0b6b3a7640000')
  assert.throws(() => toQuantity(-1n), WalletError)
})

test('an approval is for THE AMOUNT, and it is sent to the token, not to the router', () => {
  const tx = buildApproveTransaction({ token: TOKEN, spender: ROUTER, amount: 5n * ONE, from: ME })
  // `to` is the TOKEN. An approval sent to the router would be a call to a function the router does
  // not have, which reverts — but the mistake is worth an assertion because the router is the
  // address the whole rest of this page talks to.
  assert.equal(tx.to, TOKEN)
  assert.equal(tx.from, ME)
  assert.equal(tx.value, '0x0')
  assert.equal(tx.data.slice(0, 10), selector(SIG.approve))
  assert.deepEqual(words(tx.data), [encodeAddress(ROUTER), encodeUint(5n * ONE)])

  // NOT infinity. `2²⁵⁶−1` is the industry default and is why a router bug is a total loss rather
  // than a bounded one; this surface approves exactly what is about to be spent.
  assert.notEqual(words(tx.data)[1], 'f'.repeat(64))
  assert.throws(() => buildApproveTransaction({ token: TOKEN, spender: ROUTER, amount: 0n, from: ME }), WalletError)
})

test('THE NATIVE SIDE OF A DEPOSIT IS `value` AND IS NOT AN ARGUMENT', () => {
  const tx = buildAddLiquidityTransaction({
    router: ROUTER,
    tokenA: WRAPPED,
    tokenB: TOKEN,
    amountADesired: 3n * ONE,
    amountBDesired: 12n * ONE,
    amountAMin: 2n * ONE,
    amountBMin: 11n * ONE,
    from: ME,
    nowSeconds: NOW,
    aNative: true,
    bNative: false,
  })
  assert.equal(tx.to, ROUTER)
  assert.equal(tx.data.slice(0, 10), selector(SIG.addLiquidityETH))
  // The native desired amount appears ONCE, as the value.
  assert.equal(tx.value, toQuantity(3n * ONE))

  // And the arguments are in the ROUTER's order — (token, tokenDesired, tokenMin, ethMin) — with
  // the TOKEN side first, even though it was the second side of the form. This is mistake 1 from
  // the header: passing them in form order deposits the minimum of the two and does not revert.
  assert.deepEqual(words(tx.data), [
    encodeAddress(TOKEN),
    encodeUint(12n * ONE),
    encodeUint(11n * ONE),
    encodeUint(2n * ONE),
    encodeAddress(ME),
    encodeUint(BigInt(NOW + DEADLINE_SECONDS)),
  ])

  // The mirror: the same deposit with the sides swapped is the SAME transaction. If it is not, the
  // builder is reading the form's order rather than the router's.
  const mirrored = buildAddLiquidityTransaction({
    router: ROUTER,
    tokenA: TOKEN,
    tokenB: WRAPPED,
    amountADesired: 12n * ONE,
    amountBDesired: 3n * ONE,
    amountAMin: 11n * ONE,
    amountBMin: 2n * ONE,
    from: ME,
    nowSeconds: NOW,
    aNative: false,
    bNative: true,
  })
  assert.deepEqual(mirrored, tx)
})

test('a token-token deposit takes both amounts as arguments and sends no value', () => {
  const other = '0x6666666666666666666666666666666666666666'
  const tx = buildAddLiquidityTransaction({
    router: ROUTER,
    tokenA: TOKEN,
    tokenB: other,
    amountADesired: 7n * ONE,
    amountBDesired: 9n * ONE,
    amountAMin: 6n * ONE,
    amountBMin: 8n * ONE,
    from: ME,
    nowSeconds: NOW,
    aNative: false,
    bNative: false,
  })
  assert.equal(tx.data.slice(0, 10), selector(SIG.addLiquidity))
  assert.equal(tx.value, '0x0')
  assert.deepEqual(words(tx.data), [
    encodeAddress(TOKEN),
    encodeAddress(other),
    encodeUint(7n * ONE),
    encodeUint(9n * ONE),
    encodeUint(6n * ONE),
    encodeUint(8n * ONE),
    encodeAddress(ME),
    encodeUint(BigInt(NOW + DEADLINE_SECONDS)),
  ])
})

test('A MINIMUM LARGER THAN THE AMOUNT IS REFUSED RATHER THAN ENCODED', () => {
  // A guaranteed revert the reader pays gas for. The router checks `amountAMin <= amountA`, so this
  // transaction can never succeed — and "execution reverted" is all the reader would be told.
  const base = {
    router: ROUTER,
    tokenA: TOKEN,
    tokenB: WRAPPED,
    amountADesired: ONE,
    amountBDesired: ONE,
    amountAMin: ONE,
    amountBMin: ONE,
    from: ME,
    nowSeconds: NOW,
    aNative: false,
    bNative: true,
  }
  // Equal is fine: it means "any movement at all reverts", which is a real choice.
  assert.ok(buildAddLiquidityTransaction(base))
  assert.throws(() => buildAddLiquidityTransaction({ ...base, amountAMin: ONE + 1n }), WalletError)
  assert.throws(() => buildAddLiquidityTransaction({ ...base, amountBMin: ONE + 1n }), WalletError)
  // Zero on a side is not a deposit.
  assert.throws(
    () => buildAddLiquidityTransaction({ ...base, amountADesired: 0n, amountAMin: 0n }),
    WalletError,
  )
  // Native on both sides is not a pair, and the same token twice is not a pool.
  assert.throws(() => buildAddLiquidityTransaction({ ...base, aNative: true }), WalletError)
  assert.throws(
    () => buildAddLiquidityTransaction({ ...base, tokenB: TOKEN.toUpperCase().replace('0X', '0x') }),
    WalletError,
  )
  assert.throws(() => buildAddLiquidityTransaction({ ...base, router: '' }), WalletError)
})

test('THE DEADLINE IS A WINDOW FROM A GIVEN CLOCK, AND IT HAS A CEILING', () => {
  // Mistake 3. `type(uint256).max` passes the router's `require` forever, which is not a generous
  // deadline — it is no deadline, and a transaction that sat in a mempool for an hour and then
  // filled against an hour-old price is exactly what the argument exists to prevent.
  const at = (deadlineSeconds: number) =>
    words(
      buildRemoveLiquidityTransaction({
        router: ROUTER,
        tokenA: TOKEN,
        tokenB: WRAPPED,
        liquidity: ONE,
        amountAMin: 0n,
        amountBMin: 0n,
        from: ME,
        nowSeconds: NOW,
        aNative: false,
        bNative: true,
        deadlineSeconds,
      }).data,
    ).at(-1)

  for (const choice of DEADLINE_CHOICES) {
    assert.equal(at(choice.minutes * 60), encodeUint(BigInt(NOW + choice.minutes * 60)))
  }
  // The middle choice is the swap form's own constant, so the two surfaces agree without importing
  // each other's list.
  assert.ok(DEADLINE_CHOICES.some((c) => c.minutes * 60 === DEADLINE_SECONDS))

  assert.equal(at(MAX_DEADLINE_SECONDS), encodeUint(BigInt(NOW + MAX_DEADLINE_SECONDS)))
  assert.throws(() => at(MAX_DEADLINE_SECONDS + 1), WalletError)
  assert.throws(() => at(0), WalletError)
  assert.throws(() => at(-60), WalletError)
})

test('a withdrawal names the pair’s two tokens, and unwrapping is a different entry point', () => {
  const unwrapping = buildRemoveLiquidityTransaction({
    router: ROUTER,
    tokenA: WRAPPED,
    tokenB: TOKEN,
    liquidity: 4n * ONE,
    amountAMin: ONE,
    amountBMin: 2n * ONE,
    from: ME,
    nowSeconds: NOW,
    aNative: true,
    bNative: false,
  })
  assert.equal(unwrapping.data.slice(0, 10), selector(SIG.removeLiquidityETH))
  assert.equal(unwrapping.value, '0x0')
  // (token, liquidity, amountTokenMin, amountETHMin, to, deadline) — the token side first again,
  // and the two minimums therefore swapped relative to the form.
  assert.deepEqual(words(unwrapping.data), [
    encodeAddress(TOKEN),
    encodeUint(4n * ONE),
    encodeUint(2n * ONE),
    encodeUint(ONE),
    encodeAddress(ME),
    encodeUint(BigInt(NOW + DEADLINE_SECONDS)),
  ])

  // The same withdrawal without unwrapping is the token-token form, which returns WEMBER. Both are
  // legitimate; the page offers a checkbox and defaults to unwrapping.
  const keeping = buildRemoveLiquidityTransaction({
    router: ROUTER,
    tokenA: WRAPPED,
    tokenB: TOKEN,
    liquidity: 4n * ONE,
    amountAMin: ONE,
    amountBMin: 2n * ONE,
    from: ME,
    nowSeconds: NOW,
    aNative: false,
    bNative: false,
  })
  assert.equal(keeping.data.slice(0, 10), selector(SIG.removeLiquidity))
  assert.deepEqual(words(keeping.data), [
    encodeAddress(WRAPPED),
    encodeAddress(TOKEN),
    encodeUint(4n * ONE),
    encodeUint(ONE),
    encodeUint(2n * ONE),
    encodeAddress(ME),
    encodeUint(BigInt(NOW + DEADLINE_SECONDS)),
  ])

  assert.throws(
    () =>
      buildRemoveLiquidityTransaction({
        router: ROUTER,
        tokenA: WRAPPED,
        tokenB: TOKEN,
        liquidity: 0n,
        amountAMin: 0n,
        amountBMin: 0n,
        from: ME,
        nowSeconds: NOW,
        aNative: true,
        bNative: false,
      }),
    WalletError,
  )
})

test('CREATING A PAIR GOES TO THE FACTORY, TAKES NO DEADLINE AND SENDS NOTHING', () => {
  // Verified against the deployed factories on 7411 and 7412 rather than assumed: `createPair` has
  // no `msg.sender` check, so this is a transaction a stranger can send. The three ways it fails
  // are all decidable before it is sent, and two of them are refused here — the third
  // (`PAIR_EXISTS`) needs a chain read and belongs to the page.
  const tx = buildCreatePairTransaction({ factory: FACTORY, tokenA: TOKEN, tokenB: WRAPPED, from: ME })
  assert.equal(tx.to, FACTORY)
  assert.equal(tx.from, ME)
  assert.equal(tx.value, '0x0')
  assert.equal(tx.data.slice(0, 10), selector(SIG.createPair))
  assert.deepEqual(words(tx.data), [encodeAddress(TOKEN), encodeAddress(WRAPPED)])
  // No deadline: the factory takes none, and appending one would be two extra words the contract
  // ignores in the best case and misreads in the worst.
  assert.equal(words(tx.data).length, 2)

  assert.throws(
    () => buildCreatePairTransaction({ factory: FACTORY, tokenA: TOKEN, tokenB: TOKEN, from: ME }),
    WalletError,
  )
  assert.throws(
    () => buildCreatePairTransaction({ factory: FACTORY, tokenA: ZERO, tokenB: TOKEN, from: ME }),
    WalletError,
  )
  assert.throws(
    () => buildCreatePairTransaction({ factory: '', tokenA: TOKEN, tokenB: WRAPPED, from: ME }),
    WalletError,
  )
})

test('the swap builder is unchanged by any of this, and still picks its shape from the path', () => {
  // A regression guard rather than a new claim: the liquidity work added three builders beside this
  // one and shares `toQuantity` and the deadline arithmetic with it.
  const native = buildSwapTransaction({
    router: ROUTER,
    path: [WRAPPED, TOKEN],
    amountIn: ONE,
    amountOutMin: 90n,
    from: ME,
    nowSeconds: NOW,
    fromNative: true,
    toNative: false,
  })
  assert.equal(native.data.slice(0, 10), selector(SIG.swapExactETHForTokens))
  assert.equal(native.value, toQuantity(ONE))
  // Mistake 2: the input must not also be an argument. The first word is the MINIMUM.
  assert.equal(words(native.data)[0], encodeUint(90n))

  const tokens = buildSwapTransaction({
    router: ROUTER,
    path: [TOKEN, WRAPPED],
    amountIn: ONE,
    amountOutMin: 90n,
    from: ME,
    nowSeconds: NOW,
    fromNative: false,
    toNative: true,
  })
  assert.equal(tokens.data.slice(0, 10), selector(SIG.swapExactTokensForETH))
  assert.equal(tokens.value, '0x0')
  assert.equal(words(tokens.data)[0], encodeUint(ONE))
})

test('NOT ONE BUILDER NAMES AN ESTATE ADDRESS: every `to` is an argument', () => {
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // The non-custodial claim, asserted as text. Every transaction this surface builds goes to a
  // router, a factory or a token the CALLER supplied, and `to`/`from` are the reader's own address
  // in all of them. A hard-coded address in this file — a fee collector, a relayer, a "CloudsForge
  // treasury" — would be the estate taking a position in a trade it is not a party to.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  const built = [
    buildApproveTransaction({ token: TOKEN, spender: ROUTER, amount: ONE, from: ME }),
    buildCreatePairTransaction({ factory: FACTORY, tokenA: TOKEN, tokenB: WRAPPED, from: ME }),
    buildAddLiquidityTransaction({
      router: ROUTER,
      tokenA: WRAPPED,
      tokenB: TOKEN,
      amountADesired: ONE,
      amountBDesired: ONE,
      amountAMin: 0n,
      amountBMin: 0n,
      from: ME,
      nowSeconds: NOW,
      aNative: true,
      bNative: false,
    }),
    buildRemoveLiquidityTransaction({
      router: ROUTER,
      tokenA: WRAPPED,
      tokenB: TOKEN,
      liquidity: ONE,
      amountAMin: 0n,
      amountBMin: 0n,
      from: ME,
      nowSeconds: NOW,
      aNative: true,
      bNative: false,
    }),
  ]
  for (const tx of built) {
    assert.ok([ROUTER, FACTORY, TOKEN].includes(tx.to), `${tx.to} is not an address the caller gave`)
    assert.equal(tx.from, ME)
    // The recipient argument, wherever it appears, is the reader. `to: someOtherAddress` in a V2
    // call is a transaction that succeeds and delivers the proceeds somewhere else.
    const recipients = words(tx.data).filter((w) => w === encodeAddress(ME))
    if (tx.to === ROUTER) assert.equal(recipients.length, 1)
  }
})
