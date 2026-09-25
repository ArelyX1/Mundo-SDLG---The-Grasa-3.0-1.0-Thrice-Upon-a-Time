import { test } from 'node:test'
import assert from 'node:assert/strict'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { RLP } from '@ethereumjs/rlp'
import {
  EVM_CHAIN_ID,
  checksumAddress,
  isEvmAddress,
  normalizeEvmAddress,
  parseEvmTx,
  pubToEvmAddress,
  weiToRaw,
  rawToWei,
  keccak,
  EVM_WEI_SCALE,
} from '../src/evm/evm.js'
import { bytesToHex, hexToBytes } from '../src/core/crypto.js'

const sk = (seed: number = 1): Uint8Array => {
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = (i + seed * 7) % 256
  out[31] = 1
  return out
}
const addrOf = (seckey: Uint8Array) => checksumAddress(pubToEvmAddress(secp256k1.getPublicKey(seckey, false)))

function signUnsigned(unsignedFields: unknown[]): { r: bigint; s: bigint; parity: number } {
  const sigBytes = secp256k1.sign(keccak(Uint8Array.from([0x02, ...RLP.encode(unsignedFields as never)])), sk(), {
    prehash: false,
    lowS: true,
    format: 'recovered',
    extraEntropy: false,
  })
  const sig = secp256k1.Signature.fromBytes(sigBytes, 'recovered')
  return { r: sig.r, s: sig.s, parity: sig.recovery ?? 0 }
}

function buildTx(fromSk: Uint8Array, to: string, value: bigint, nonce: bigint): string {
  const toB = hexToBytes(to.slice(2))
  const unsigned = [BigInt(EVM_CHAIN_ID), nonce, 1n, 10n, 21000n, toB, value, new Uint8Array(0), []]
  const { r, s, parity } = signUnsigned(unsigned)
  const full = [EVM_CHAIN_ID, nonce, 1n, 10n, 21000n, toB, value, new Uint8Array(0), [], BigInt(parity), r, s]
  return '0x' + bytesToHex(Uint8Array.from([0x02, ...RLP.encode(full as never)]))
}

test('checksum EIP-55 ejemplos classicos', () => {
  assert.equal(checksumAddress('0x52908400098527886E0F7030069857D2E4169EE7'), '0x52908400098527886E0F7030069857D2E4169EE7')
  assert.equal(checksumAddress('0x8617E340B3D01FA5F11F306F4090FD50E238070D'), '0x8617E340B3D01FA5F11F306F4090FD50E238070D')
  assert.equal(isEvmAddress('0x' + 'ab'.repeat(20)), true)
  assert.equal(isEvmAddress('0x' + 'ab'.repeat(19)), false)
  assert.equal(isEvmAddress('sdlg123'), false)
})

test('wei <-> raw de PAPU', () => {
  assert.equal(weiToRaw(rawToWei(123456789n)), 123456789n)
  assert.equal(rawToWei(1n), EVM_WEI_SCALE)
  assert.throws(() => weiToRaw(5n), /no divisible/)
})

test('parseo y recuperacion de EIP-1559 round-trip', () => {
  const fromSk = sk()
  const from = addrOf(fromSk)
  const to = addrOf(sk())
  const raw = buildTx(fromSk, to, 500000000000000000n, 0n)
  const parsed = parseEvmTx(raw)
  assert.equal(normalizeEvmAddress(parsed.from), normalizeEvmAddress(from))
  assert.equal(normalizeEvmAddress(parsed.to), normalizeEvmAddress(to))
  assert.equal(parsed.value, 500000000000000000n)
  assert.equal(parsed.nonce, 0n)
  assert.equal(parsed.type, 2)
  assert.equal(parsed.data, '')
})

test('firma tamperada se rechaza', () => {
  const fromSk = sk()
  const from = addrOf(fromSk)
  const to = addrOf(sk())
  const raw = buildTx(fromSk, to, 1000000000000000000n, 0n)
  const tampered = raw.slice(0, raw.length - 2) + (raw.endsWith('00') ? '01' : '00')
  const parsed = parseEvmTx(raw)
  const parsed2 = parseEvmTx(tampered)
  // el tamper rompe la recuperacion (from distinto) o la firma
  assert.notEqual(normalizeEvmAddress(parsed2.from), normalizeEvmAddress(from))
  void parsed
})

test('facade ERC-20: selectores name/symbol/decimals/balanceOf', async () => {
  const { SELECTORS, erc20Call, PAPU_TOKEN_ADDRESS, PAPU_TOKEN } = await import('../src/evm/erc20.js')
  const word = (hex: string, at: number): bigint => BigInt('0x' + hex.slice(2 + at * 64, 2 + at * 64 + 64))
  const decodeString = (hex: string): string => {
    const len = Number(word(hex, 1))
    const data = hex.slice(2 + 2 * 64, 2 + 2 * 64 + len * 2)
    return new TextDecoder().decode(hexToBytes(data))
  }
  const reply = (data: string) => erc20Call(data, (addr) => (addr === normalizeEvmAddress('0x' + 'aa'.repeat(20)) ? rawToWei(100n) : 0n))
  assert.equal(decodeString(reply(SELECTORS.name)), PAPU_TOKEN.name)
  assert.equal(decodeString(reply(SELECTORS.symbol)), PAPU_TOKEN.symbol)
  assert.equal(word(reply(SELECTORS.decimals), 0), 18n)
  const balData = SELECTORS.balanceOf + '0'.repeat(24) + 'aa'.repeat(20)
  assert.equal(word(reply(balData), 0), rawToWei(100n))
  assert.equal(erc20Call(SELECTORS.transfer + '00', () => 0n), '0x')
  void PAPU_TOKEN_ADDRESS
})