import { test } from 'node:test'
import assert from 'node:assert'
import {
  generateKeypair,
  addressFromPublicKey,
  publicKeyFromAddress,
  signString,
  verifyString,
  isValidAddress,
  blakeHex,
} from '../src/core/crypto.js'
import { base58Encode, base58Decode } from '../src/core/base58.js'
import { stateRoot } from '../src/core/merkle.js'

test('base58 roundtrip', () => {
  const data = new TextEncoder().encode('hola mundo sdlg 123456')
  assert.equal(base58Decode(base58Encode(data)).length, data.length)
  assert.deepEqual([...base58Decode(base58Encode(data))], [...data])
})

test('ed25519 sign/verify', () => {
  const kp = generateKeypair()
  const sig = signString('mensaje', kp.secretKey)
  assert.ok(verifyString(kp.publicKey, sig, 'mensaje'))
  assert.ok(!verifyString(kp.publicKey, sig, 'otro'))
})

test('direcciones', () => {
  const kp = generateKeypair()
  const addr = addressFromPublicKey(kp.publicKey)
  assert.ok(addr.startsWith('sdlg'))
  assert.equal(publicKeyFromAddress(addr), kp.publicKey)
  assert.ok(isValidAddress(addr))
  assert.ok(!isValidAddress(addr.slice(0, -1) + 'x'))
})

test('stateRoot determinista', () => {
  const a = new Map<string, string>([
    ['b', '1'],
    ['a', '2'],
  ])
  const b = new Map<string, string>([
    ['a', '2'],
    ['b', '1'],
  ])
  assert.equal(stateRoot(a), stateRoot(b))
  const c = new Map<string, string>([['a', '3']])
  assert.notEqual(stateRoot(a), stateRoot(c))
})

test('blake estable', () => {
  assert.equal(blakeHex('x'), blakeHex('x'))
  assert.match(blakeHex('x'), /^[0-9a-f]{64}$/)
})