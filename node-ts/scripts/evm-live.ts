import { secp256k1 } from '@noble/curves/secp256k1.js'
import { RLP } from '@ethereumjs/rlp'
import { bytesToHex, hexToBytes } from '../src/core/crypto.js'
import {
  EVM_CHAIN_ID,
  checksumAddress,
  pubToEvmAddress,
  keccak,
} from '../src/evm/evm.js'

const RPC = process.argv[2] ?? 'http://127.0.0.1:8545'
const api = process.argv[3] ?? 'http://127.0.0.1:8080'

async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = await r.json()
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`)
  return j.result
}
async function get(path: string): Promise<any> {
  const r = await fetch(api + path)
  return r.json()
}

function genKey(seed: number): { sk: Uint8Array; address: string } {
  const sk = new Uint8Array(32)
  for (let i = 0; i < 32; i++) sk[i] = (i * 13 + seed) % 251
  sk[31] = 1
  sl_adj(sk)
  const pub = secp256k1.getPublicKey(sk, false)
  return { sk, address: checksumAddress(pubToEvmAddress(pub)) }
  function sl_adj(u: Uint8Array) {
    const n = BigInt('0x' + bytesToHex(u))
    const q = BigInt(
      '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
    )
    if (n >= q) u[31] -= 1
  }
}

async function signedRawTx(
  sk: Uint8Array,
  to: string,
  valueWei: bigint,
  nonce: bigint,
): Promise<string> {
  const toB = hexToBytes(to.slice(2))
  const unsigned = [
    BigInt(EVM_CHAIN_ID),
    nonce,
    1000000000n,
    1000000000n,
    21000n,
    toB,
    valueWei,
    new Uint8Array(0),
    [],
  ]
  const sig = secp256k1.Signature.fromBytes(
    secp256k1.sign(
      keccak(Uint8Array.from([0x02, ...RLP.encode(unsigned as never)])),
      sk,
      { prehash: false, lowS: true, format: 'recovered', extraEntropy: false },
    ),
    'recovered',
  )
  const full = [
    ...(unsigned as never[]),
    BigInt(sig.recovery ?? 0),
    sig.r,
    sig.s,
  ]
  return '0x' + bytesToHex(Uint8Array.from([0x02, ...RLP.encode(full as never)]))
}

function weiToPapu(wei: bigint): string {
  return (wei / 10n ** 6n / 10n ** 12n).toString()
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

const alice = genKey(1)
const bob = genKey(2)

console.log('alice:', alice.address)
console.log('bob:  ', bob.address)
console.log('chainId (eth_chainId):', await rpc('eth_chainId', []))

console.log('\n1) faucet alice via /evm/faucet')
const fa = await fetch(RPC + '/evm/faucet', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ address: alice.address }),
})
console.log('faucet:', fa.status, JSON.stringify(await fa.json()))

let bal = BigInt(await rpc('eth_getBalance', [alice.address, 'latest']))
for (let i = 0; i < 20 && bal === 0n; i++) {
  await sleep(1000)
  bal = BigInt(await rpc('eth_getBalance', [alice.address, 'latest']))
}
console.log('balance alice:', bal.toString(), 'wei =', weiToPapu(bal), 'PAPU')
let nonce = BigInt(await rpc('eth_getTransactionCount', [alice.address, 'latest']))
console.log('nonce alice:', nonce.toString())

console.log('\n2) EIP-1559 alice -> bob (500 PAPU)')
const raw = await signedRawTx(alice.sk, bob.address, 500_000_000_000_000_000_000n, nonce)
const txHash = await rpc('eth_sendRawTransaction', [raw])
console.log('txHash:', txHash)

let receipt: any = null
for (let i = 0; i < 20 && !receipt; i++) {
  await sleep(1500)
  receipt = await rpc('eth_getTransactionReceipt', [txHash]).catch(() => null)
}
console.log('receipt:', JSON.stringify(receipt))

bal = BigInt(await rpc('eth_getBalance', [alice.address, 'latest']))
const balB = BigInt(await rpc('eth_getBalance', [bob.address, 'latest']))
nonce = BigInt(await rpc('eth_getTransactionCount', [alice.address, 'latest']))
console.log('post alice:', bal.toString(), 'wei =', weiToPapu(bal), 'PAPU, nonce', nonce.toString())
console.log('post bob:  ', balB.toString(), 'wei =', weiToPapu(balB), 'PAPU')

console.log('\n3) tx vista por hash')
const byHash = await rpc('eth_getTransactionByHash', [txHash])
console.log('byHash:', JSON.stringify({ hash: byHash?.hash, to: byHash?.to, value: byHash?.value, type: byHash?.type }))

console.log('\n4) consenso: head y stateRoot en los 4 nodos (economy /health)')
for (let i = 0; i < 4; i++) {
  const res = await fetch(`http://127.0.0.1:${8080 + i}/health`)
  const j = await res.json()
  console.log(`node-${i} head`, j.head, 'root', j.stateRoot.slice(0, 16))
}
console.log('\nOK ✓')