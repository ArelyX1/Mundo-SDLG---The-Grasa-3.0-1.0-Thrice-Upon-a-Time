// Genera transacciones EVM firmadas y sus emisores esperados, usando noble
// (independiente del codigo Go) para producir el vector de referencia.
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { RLP } from '@ethereumjs/rlp'

const CHAIN_ID = 5120n

// Clave fija para que el vector sea reproducible.
const privKey = new Uint8Array(32).fill(0x11)
privKey[31] = 0x42
const pub = secp256k1.getPublicKey(privKey, false)
const pubCompressed = secp256k1.getPublicKey(privKey, true)

// noble v2 devuelve la firma compacta de 64 bytes sin id de recuperacion, asi
// que lo deducimos probando los cuatro y comparando con la pubkey conocida.
function parityOf(sig64, sigHash) {
  for (let id = 0; id < 4; id++) {
    const c = new Uint8Array(65)
    c[0] = id
    c.set(sig64, 1)
    try {
      if (Buffer.compare(Buffer.from(secp256k1.recoverPublicKey(c, sigHash, { prehash: false })), Buffer.from(pubCompressed)) === 0) return id
    } catch {}
  }
  throw new Error('no se pudo deducir la paridad')
}
const from = '0x' + Buffer.from(keccak_256(pub.slice(1)).slice(12)).toString('hex')

const to = new Uint8Array(20).fill(0x35)
const value = 5n * 10n ** 18n
const nonce = 7n
const gas = 21000n

// bigint -> enteros big-endian minimos, que es como RLP codifica un escalar.
const num = (v) => {
  if (v === 0n) return new Uint8Array(0)
  let h = v.toString(16)
  if (h.length % 2) h = '0' + h
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

const out = { from, chainId: Number(CHAIN_ID), txs: [] }

function signLegacy() {
  const fields = [num(nonce), num(20n * 10n ** 9n), num(gas), to, num(value), new Uint8Array(0)]
  const signing = RLP.encode([...fields, CHAIN_ID, new Uint8Array(0), new Uint8Array(0)])
  const sigHash = keccak_256(signing)
  const sig = secp256k1.sign(sigHash, privKey, { prehash: false })
  const parity = parityOf(sig, sigHash)
  const v = CHAIN_ID * 2n + 35n + BigInt(parity)
  const raw = RLP.encode([...fields, num(v), sig.slice(0, 32), sig.slice(32)])
  return { type: 0, raw: '0x' + Buffer.from(raw).toString('hex'), sigHash: '0x' + Buffer.from(sigHash).toString('hex') }
}

function signTyped(type, txNonce = nonce) {
  const unsigned = type === 2
    ? [CHAIN_ID, txNonce, 10n ** 9n, 20n * 10n ** 9n, gas, to, value, new Uint8Array(0), []]
    : [CHAIN_ID, txNonce, 20n * 10n ** 9n, gas, to, value, new Uint8Array(0), []]
  const sigHash = keccak_256(Uint8Array.from([type, ...RLP.encode(unsigned)]))
  const sig = secp256k1.sign(sigHash, privKey, { prehash: false })
  const parity = parityOf(sig, sigHash)
  const raw = Uint8Array.from([type, ...RLP.encode([...unsigned, BigInt(parity), sig.slice(0, 32), sig.slice(32)])])
  return { type, raw: '0x' + Buffer.from(raw).toString('hex'), sigHash: '0x' + Buffer.from(sigHash).toString('hex') }
}

out.txs.push(signLegacy())
out.txs.push(signTyped(1))
out.txs.push(signTyped(2))

// La primera transaccion de una cuenta nueva: nonce 0, que es lo que una
// billetera que nunca ha enviado envia, y lo que un servicio con proteccion de
// replay tiene que aceptar de una cuenta sin historial.
out.firstSend = signTyped(2, 0n)

// Vector con s alto (malleable) para comprobar que se rechaza.
{
  const fields = [num(nonce), num(20n * 10n ** 9n), num(gas), to, num(value), new Uint8Array(0)]
  const sigHash = keccak_256(RLP.encode([...fields, CHAIN_ID, new Uint8Array(0), new Uint8Array(0)]))
  // Orden de grupo de secp256k1 (constante publica del dominio).
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
  const sig = secp256k1.sign(sigHash, privKey, { prehash: false })
  const lowS = sig.slice(32)
  const highS = N - BigInt('0x' + Buffer.from(lowS).toString('hex'))
  const parity = parityOf(sig, sigHash)
  // El id de recuperacion puede cambiar al invertir s, asi que se deduce de nuevo.
  const sigHighS = new Uint8Array(64)
  sigHighS.set(sig.slice(0, 32), 0)
  sigHighS.set(num(highS), 32)
  const parityHigh = parityOf(sigHighS, sigHash)
  const v = CHAIN_ID * 2n + 35n + BigInt(parityHigh)
  const raw = RLP.encode([...fields, num(v), sig.slice(0, 32), num(highS)])
  out.highS = { type: 0, raw: '0x' + Buffer.from(raw).toString('hex') }
}

console.log(JSON.stringify(out, null, 2))
