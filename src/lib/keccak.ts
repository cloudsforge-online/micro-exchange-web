/**
 * Keccak-256, in the browser.
 *
 * ── Why a hash function is in a frontend at all ────────────────────────────────────────────────
 *
 * Two reasons, and both are the same reason: **so that this bundle never has to be told a number
 * it could derive.**
 *
 *   1. **Function selectors.** `claim()` is a four-byte selector, and `micro-foresight` does not
 *      serve one — there is no claim-intent route (`foresight/src/server.ts` is the whole
 *      route table, and staking is the only intent it mints). So this app builds the claim
 *      calldata itself. A hard-coded `0x4e71d92d` would be a magic constant nobody could check
 *      without a second tool; derived from the signature, it is checkable by reading the
 *      signature. See `abi.ts`.
 *   2. **The question hash.** `GET /markets/:id` returns the canonical document AND its hash
 *      (`foresight/src/server.ts`) precisely so a reader can recompute the hash and check
 *      it against the one in the contract, "rather than taking the platform's word that the
 *      criteria have not been edited since it opened" (`server.ts`). A frontend that
 *      displays the hash the server sent, beside the document the server sent, has verified
 *      nothing. This one recomputes it.
 *
 * ── Why hand-rolled rather than a dependency ───────────────────────────────────────────────────
 *
 * `SubtleCrypto` has SHA-256 and SHA-384 and SHA-512, and no Keccak — and Node's has SHA3-256,
 * which is NOT a substitute: it is the same permutation with a different padding byte (NIST
 * appends `0x06`, Ethereum `0x01`), so using it produces plausible-looking wrong answers. The
 * alternative is a dependency in a bundle whose whole security story is that it ships nothing it
 * has not read.
 *
 * The permutation below is carried across from `foresight/src/keccak.ts` UNCHANGED, which
 * is itself carried from `wallet/src/keccak.ts`. Two implementations of one primitive in one
 * estate is a difference that presents as a payout refused for a selector the other side computed
 * differently. The one thing not carried is the hex helper: the service's uses `Buffer`, which
 * does not exist here.
 *
 * ── How it is tested, which is the part that matters ───────────────────────────────────────────
 *
 * `test/keccak.test.ts` does three things, and the second is the strong one:
 *
 *   1. The published vector, `keccak256("") = c5d24601…`, which pins the domain byte.
 *   2. **The permutation is checked against Node's own SHA3-256** over inputs of every length
 *      around the 136-byte rate boundary. `sha3_256` below is this exact sponge with the NIST
 *      padding byte, so if the permutation, the rate, the lane packing or the absorb loop were
 *      wrong in any way, it would disagree with OpenSSL. That leaves precisely one constant — the
 *      domain byte — unverified by it, which is what (1) pins.
 *   3. The selectors this app actually sends, against their published values.
 */


const MASK64 = (1n << 64n) - 1n

/** Keccak-f[1600] round constants — the ι step. */
const ROUND_CONSTANTS: readonly bigint[] = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
])

/**
 * ρ rotation offsets, indexed by lane `x + 5y`.
 *
 * Laid out as five rows of five so it can be read against the table in FIPS 202 §3.2.2 rather
 * than trusted as twenty-five loose numbers.
 */
const ROTATIONS: readonly number[] = Object.freeze([
  /* y=0 */ 0, 1, 62, 28, 27,
  /* y=1 */ 36, 44, 6, 55, 20,
  /* y=2 */ 3, 10, 43, 25, 39,
  /* y=3 */ 41, 45, 15, 21, 8,
  /* y=4 */ 18, 2, 61, 56, 14,
])

function rotl(value: bigint, bits: number): bigint {
  if (bits === 0) return value
  const n = BigInt(bits)
  return ((value << n) | (value >> (64n - n))) & MASK64
}

/** Keccak-f[1600], in place on a 25-lane state. */
function permute(lanes: bigint[]): void {
  const c: bigint[] = [0n, 0n, 0n, 0n, 0n]
  const b: bigint[] = new Array<bigint>(25).fill(0n)

  for (const rc of ROUND_CONSTANTS) {
    // θ — parity of each column, folded back into every lane of the two neighbouring columns.
    for (let x = 0; x < 5; x++) {
      c[x] = lanes[x]! ^ lanes[x + 5]! ^ lanes[x + 10]! ^ lanes[x + 15]! ^ lanes[x + 20]!
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1)
      for (let y = 0; y < 25; y += 5) lanes[x + y] = lanes[x + y]! ^ d
    }

    // ρ and π together: rotate each lane, then move it to its permuted position.
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(lanes[x + 5 * y]!, ROTATIONS[x + 5 * y]!)
      }
    }

    // χ — the only non-linear step.
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        lanes[x + y] = b[x + y]! ^ (~b[((x + 1) % 5) + y]! & MASK64 & b[((x + 2) % 5) + y]!)
      }
    }

    // ι.
    lanes[0] = lanes[0]! ^ rc
  }
}

/**
 * The sponge, parameterised by the domain-separation byte.
 *
 * `0x01` is original Keccak, which is what Ethereum uses. `0x06` is SHA-3 as standardised. The
 * byte is the *only* difference, and exposing it is what lets the test compare this construction
 * against OpenSSL's SHA3-256.
 */
function sponge(message: Uint8Array, domainByte: number, outputBytes: number): Uint8Array {
  const rate = 200 - 2 * outputBytes // 136 bytes for a 256-bit digest
  const lanes: bigint[] = new Array<bigint>(25).fill(0n)

  // Multi-rate padding: the domain byte at the front of the tail, 0x80 at the end of the block.
  // They land on the same byte when the tail is exactly one byte long, which is why this is an
  // OR rather than two writes.
  const padded = new Uint8Array(Math.ceil((message.length + 1) / rate) * rate)
  padded.set(message)
  padded[message.length] = domainByte
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) | 0x80

  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      // Little-endian lane packing, as FIPS 202 §B.1 specifies.
      let lane = 0n
      for (let byte = 7; byte >= 0; byte--) {
        lane = (lane << 8n) | BigInt(padded[offset + i * 8 + byte] ?? 0)
      }
      lanes[i] = lanes[i]! ^ lane
    }
    permute(lanes)
  }

  const out = new Uint8Array(outputBytes)
  for (let i = 0; i < outputBytes; i++) {
    const lane = lanes[Math.floor(i / 8)]!
    out[i] = Number((lane >> BigInt(8 * (i % 8))) & 0xffn)
  }
  return out
}

/** Keccak-256, as Ethereum and Hearth use it. */
export function keccak256(message: Uint8Array): Uint8Array {
  return sponge(message, 0x01, 32)
}

/**
 * SHA3-256, as FIPS 202 standardised it.
 *
 * Exported **only** so the test can compare this permutation against Node's, which is an
 * independent implementation of the same primitive. Nothing in the service calls it; if something
 * ever needs SHA3 it should call `node:crypto`, which is faster and audited.
 */
export function sha3_256(message: Uint8Array): Uint8Array {
  return sponge(message, 0x06, 32)
}

/**
 * Lower-case hex, no `0x`. Written out rather than delegated to `Buffer`, which is Node's.
 *
 * `padStart` on every byte: a byte below 0x10 renders as one character otherwise, and a digest
 * one character short is a digest that still looks like a digest.
 */
export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** `0x`-prefixed lower-case hex. What an EVM RPC wants and what a block explorer shows. */
export function toHex0x(bytes: Uint8Array): string {
  return `0x${toHex(bytes)}`
}

/** Keccak-256 of a UTF-8 string, as `0x`-prefixed hex. */
export function keccak256Utf8(text: string): string {
  return toHex0x(keccak256(new TextEncoder().encode(text)))
}
