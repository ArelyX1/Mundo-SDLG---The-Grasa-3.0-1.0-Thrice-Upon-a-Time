import { test } from 'node:test'
import assert from 'node:assert'
import { State } from '../src/chain/state.js'
import {
  papucoinService,
  parseAmount,
  formatRaw,
  balanceOf,
  supplyOf,
  buildWorkItem,
  nonceOf,
  PAPUCOIN,
} from '../src/services/papucoin/service.js'
import { generateKeypair, addressFromPublicKey } from '../src/core/crypto.js'
import type { WorkItem } from '../src/jam/work-package.js'

function addr(): { pub: string; secret: string; address: string } {
  const kp = generateKeypair()
  return { pub: kp.publicKey, secret: kp.secretKey, address: addressFromPublicKey(kp.publicKey) }
}

function setup() {
  const issuer = addr()
  const alice = addr()
  const bob = addr()
  const state = new State()
  papucoinService.genesisSetup!(state, {
    issuer: issuer.address,
    initialBalances: { [issuer.address]: '1000000', [alice.address]: '1000000' },
    maxSupply: `${PAPUCOIN.maxSupply / (10n ** 12n)}`,
  })
  return { state, issuer, alice, bob }
}

function run(state: State, item: WorkItem): void {
  const r = papucoinService.refine(item)
  assert.ok(r.ok, `refine fallo: ${'error' in r ? r.error : ''}`)
  if (r.ok) papucoinService.accumulate([{ item, output: r.output }], state, 1)
}

test('transfer: mueve fondos y quema comision', () => {
  const { state, alice, bob } = setup()
  const nonce = Number(nonceOf(state, alice.address))
  const item = buildWorkItem(alice.secret, alice.address, 'transfer', { to: bob.address, amount: '100' }, nonce)
  run(state, item)
  assert.equal(balanceOf(state, bob.address), 100n * 10n ** 12n)
  assert.equal(balanceOf(state, alice.address), 1_000_000n * 10n ** 12n - 100n * 10n ** 12n - PAPUCOIN.transferFee)
  assert.equal(supplyOf(state), 2_000_000n * 10n ** 12n - PAPUCOIN.transferFee)
})

test('nonce impide replay', () => {
  const { state, alice, bob } = setup()
  const item = buildWorkItem(alice.secret, alice.address, 'transfer', { to: bob.address, amount: '1' }, 1)
  run(state, item)
  // replay del mismo item (nonce 1) no debe aplicar
  run(state, item)
  assert.equal(balanceOf(state, bob.address), 1n * 10n ** 12n)
})

test('saldo insuficiente no se aplica', () => {
  const { state, alice, bob } = setup()
  const item = buildWorkItem(alice.secret, alice.address, 'transfer', { to: bob.address, amount: '99999999' }, 1)
  const r = papucoinService.refine(item)
  assert.ok(r.ok)
  if (r.ok) papucoinService.accumulate([{ item, output: r.output }], state, 1)
  assert.equal(balanceOf(state, bob.address), 0n)
})

test('mint solo el issuer y respeta max supply', () => {
  const { state, issuer, alice } = setup()
  const mi = buildWorkItem(issuer.secret, issuer.address, 'mint', { to: alice.address, amount: '500000000' }, 1)
  run(state, mi)
  assert.equal(supplyOf(state), (2_000_000n + 500_000_000n) * 10n ** 12n)

  // no emisor no puede mintear
  const other = addr()
  const bad = buildWorkItem(other.secret, other.address, 'mint', { to: issuer.address, amount: '1' }, 1)
  const r = papucoinService.refine(bad)
  assert.ok(r.ok)
  if (r.ok) papucoinService.accumulate([{ item: bad, output: r.output }], state, 2)
  const before = supplyOf(state)
  assert.equal(before, (2_000_000n + 500_000_000n) * 10n ** 12n)
})

test('faucet: un solo reclamo por direccion', () => {
  const { state, alice } = setup()
  const before = balanceOf(state, alice.address)
  const f1 = buildWorkItem(alice.secret, alice.address, 'faucet', {}, 1)
  run(state, f1)
  const after1 = balanceOf(state, alice.address)
  assert.equal(after1 - before, PAPUCOIN.faucetAmount)
  const f2 = buildWorkItem(alice.secret, alice.address, 'faucet', {}, 2)
  run(state, f2)
  assert.equal(balanceOf(state, alice.address), after1)
})

test('welcome: 5 PAPU una sola vez por wallet (no vale reconectar)', () => {
  const { state, alice, bob } = setup()
  const before = balanceOf(state, bob.address)
  const w1 = buildWorkItem(alice.secret, alice.address, 'welcome', { to: bob.address }, 1)
  run(state, w1)
  assert.equal(balanceOf(state, bob.address) - before, PAPUCOIN.welcomeAmount)
  // segunda wallet distinta tambien recibe
  const carol = addr()
  const w2 = buildWorkItem(alice.secret, alice.address, 'welcome', { to: carol.address }, 2)
  run(state, w2)
  assert.equal(balanceOf(state, carol.address), PAPUCOIN.welcomeAmount)
  // mismo target de nuevo (reconectado) -> nada
  const before2 = balanceOf(state, bob.address)
  const w3 = buildWorkItem(alice.secret, alice.address, 'welcome', { to: bob.address }, 3)
  run(state, w3)
  assert.equal(balanceOf(state, bob.address), before2)
})

test('parseAmount y formatRaw son inversos', () => {
  assert.equal(parseAmount('123.000001') * 2n, parseAmount('246.000002'))
  assert.equal(formatRaw(parseAmount('1000000000.5')), formatRaw(parseAmount('1000000000.5')))
  assert.equal(formatRaw(1n * 10n ** 12n), '1')
  assert.equal(formatRaw(1_050_000_000_000n), '1.05')
  assert.throws(() => parseAmount('1.0000000000001'))
})