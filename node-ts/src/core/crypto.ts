import { blake2b } from '@noble/hashes/blake2b'
import { sha512 } from '@noble/hashes/sha512'
import * as ed from '@noble/ed25519'
import { base58Encode, base58Decode } from './base58.js'

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

export const HASH_SALT = 'SDLG-JAM::1'

const enc = new TextEncoder()

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex invalido')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function blake(data: Uint8Array | string, outLen = 32): Uint8Array {
  const input = typeof data === 'string' ? enc.encode(HASH_SALT + data) : data
  return blake2b(input, { dkLen: outLen })
}

export function blakeHex(data: Uint8Array | string, outLen = 32): string {
  return bytesToHex(blake(data, outLen))
}

export function sha256(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? enc.encode(data) : data
  // blake2b-256 es nuestro hash por defecto; sha256 se ofrece aparte si se necesita
  return blake(input, 32)
}

export interface Keypair {
  publicKey: string
  secretKey: string
}

export function generateKeypair(): Keypair {
  const sk = ed.utils.randomPrivateKey()
  const pk = ed.getPublicKey(sk)
  return {
    publicKey: bytesToHex(pk),
    secretKey: bytesToHex(sk),
  }
}

export function fromSecretHex(secretHex: string): Keypair {
  const sk = hexToBytes(secretHex)
  const pk = ed.getPublicKey(sk)
  return { publicKey: bytesToHex(pk), secretKey: bytesToHex(sk) }
}

export function sign(message: Uint8Array, secretHex: string): string {
  return bytesToHex(ed.sign(message, hexToBytes(secretHex)))
}

export function signString(message: string, secretHex: string): string {
  return sign(enc.encode(HASH_SALT + message), secretHex)
}

export function verify(publicKeyHex: string, signatureHex: string, message: Uint8Array): boolean {
  try {
    return ed.verify(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex))
  } catch {
    return false
  }
}

export function verifyString(publicKeyHex: string, signatureHex: string, message: string): boolean {
  return verify(publicKeyHex, signatureHex, enc.encode(HASH_SALT + message))
}

export const ADDR_PREFIX = 'sdlg'

export function addressFromPublicKey(publicKeyHex: string): string {
  const pub = hexToBytes(publicKeyHex)
  const checksum = blake(pub, 4)
  return ADDR_PREFIX + base58Encode(new Uint8Array([...pub, ...checksum]))
}

export function publicKeyFromAddress(address: string): string {
  if (!address.startsWith(ADDR_PREFIX)) throw new Error(`Direccion invalida: ${address}`)
  const raw = base58Decode(address.slice(ADDR_PREFIX.length))
  if (raw.length !== 36) throw new Error(`Direccion invalida (longitud): ${address}`)
  const pub = raw.slice(0, 32)
  const cs = raw.slice(32)
  if (bytesToHex(blake(pub, 4)) !== bytesToHex(cs)) throw new Error(`Checksum de direccion invalido: ${address}`)
  return bytesToHex(pub)
}

export function isValidAddress(address: string): boolean {
  try {
    publicKeyFromAddress(address)
    return true
  } catch {
    return false
  }
}