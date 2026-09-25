import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { RLP } from '@ethereumjs/rlp'
import { bytesToHex, hexToBytes } from '../core/crypto.js'

/** Nombre de red que MetaMask asocia al chainId (coincide con el repo: Mundo SDLG). */
export const EVM_CHAIN_NAME = 'Mundo SDLG'
/**
 * Chain ID de la red EVM de SDLG-JAM (MetaMask lo pide al agregar la red).
 * `5120` NO esta registrado en chainlist/ethereum-lists-chains (el registro que
 * MetaMask usa para sus avisos), asi que no muestra "el nombre de red no coincide
 * con el chain ID". `512` es "Double-A Chain" y `1337` es "Geth Testnet", por eso
 * ambos si advertian.
 */
export const EVM_CHAIN_ID = 5120
/** Los 12 decimales de PAPU se exponen como 18 en EVM: rawEVM = rawPAPU * 1e6. */
export const EVM_WEI_SCALE = 1_000_000n
/** Costo de gas fijo por tx EVM (1 micro-PAPU, quemado, igual que una transferencia PAPU normal). */
export const EVM_GAS = 21_000n

export function keccak(data: Uint8Array): Uint8Array {
  return keccak_256(data)
}
export function keccakHex(data: Uint8Array): string {
  return bytesToHex(keccak(data))
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

export function strip0x(hex: string): string {
  return hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
}

export function isEvmAddress(input: unknown): input is string {
  return typeof input === 'string' && ADDR_RE.test(input)
}

export function normalizeEvmAddress(input: string): string {
  return input.toLowerCase()
}

/** EIP-55: checksum de direccion a partir de una 0x lowercase. */
export function checksumAddress(input: string): string {
  const lower = normalizeEvmAddress(input).slice(2)
  const hash = bytesToHex(keccak(new TextEncoder().encode(lower)))
  let out = '0x'
  for (let i = 0; i < 40; i++) {
    const c = lower[i]!
    out += parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c
  }
  return out
}

export const ZERO_ADDRESS = '0x' + '00'.repeat(20)

/** Direccion EVM desde una clave publica secp256k1 (65 bytes sin comprimir). */
export function pubToEvmAddress(pubUncompressed: Uint8Array): string {
  const hash = keccak(pubUncompressed.subarray(1))
  return '0x' + bytesToHex(hash.subarray(hash.length - 20))
}

export function weiToRaw(valueWei: bigint): bigint {
  if (valueWei % EVM_WEI_SCALE !== 0n) throw new Error(`valor ${valueWei} wei no divisible por 1e6 (granularidad de 1 micro-PAPU)`)
  return valueWei / EVM_WEI_SCALE
}

export function rawToWei(raw: bigint): bigint {
  return raw * EVM_WEI_SCALE
}

function toBig(bytes: Uint8Array): bigint {
  const hex = bytesToHex(bytes)
  return hex ? BigInt('0x' + hex) : 0n
}

function toBytes32(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(32)
  out.set(bytes.subarray(0, 32), 32 - Math.min(32, bytes.length))
  return out
}

export interface ParsedEvmTx {
  /** 0x legacy, 1 EIP-2930, 2 EIP-1559 */
  type: 0 | 1 | 2
  /** remitente recuperado (EIP-55) */
  from: string
  /** destino (EIP-55) o '' si es creacion de contrato */
  to: string
  /** valor en wei (18 decimales) */
  value: bigint
  nonce: bigint
  gasLimit: bigint
  /** hash de la tx = keccak(raw) */
  txHash: string
  data: string
}

function recoverSender(sigHash: Uint8Array, rBytes: Uint8Array, sBytes: Uint8Array, parity: number): string {
  const r = toBytes32(rBytes)
  const s = toBytes32(sBytes)
  const compact = new Uint8Array(64)
  compact.set(r, 0)
  compact.set(s, 32)
  const sig = secp256k1.Signature.fromBytes(compact, 'compact').addRecoveryBit(parity)
  const point = sig.recoverPublicKey(sigHash)
  return checksumAddress(pubToEvmAddress(point.toBytes(false)))
}

const toEip55 = (b: Uint8Array): string | null =>
  b.length === 0 ? null : checksumAddress('0x' + bytesToHex(b))

/** Parsea y verifica una firma ECDSA de transaccion Ethereum (legacy, EIP-2930 o EIP-1559). */
export function parseEvmTx(rawHex: string): ParsedEvmTx {
  const raw = hexToBytes(strip0x(rawHex))
  if (!raw.length) throw new Error('tx vacia')
  const txHash = '0x' + keccakHex(raw)
  const first = raw[0]!
  if (first === 0x02) return parseTyped(txHash, raw.subarray(1), 2)
  if (first === 0x01) return parseTyped(txHash, raw.subarray(1), 1)
  return parseLegacy(txHash, raw)
}

function parseTyped(txHash: string, payload: Uint8Array, type: 1 | 2): ParsedEvmTx {
  const dec = RLP.decode(payload) as unknown as [
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array | Uint8Array[],
    Uint8Array,
    Uint8Array,
    Uint8Array,
  ]
  if (dec.length !== (type === 2 ? 12 : 11)) throw new Error('campos de tx invalidos')
  const [chainIdB, nonceB, priB, maxB, gasB, toB, valueB, dataB, accessList, parityB, rB, sB] = dec
  if (toBig(chainIdB) !== BigInt(EVM_CHAIN_ID)) throw new Error(`chainId invalido: se espera ${EVM_CHAIN_ID}`)
  const sigHash = keccak(Uint8Array.from([type, ...RLP.encode([chainIdB, nonceB, priB, maxB, gasB, toB, valueB, dataB, accessList] as unknown as Parameters<typeof RLP.encode>[0])]))
  const to = toEip55(toB)
  if (!to) throw new Error('tx de creacion de contrato no soportada')
  const parity = Number(toBig(parityB))
  const from = recoverSender(sigHash, rB, sB, parity)
  return { type, from, to, value: toBig(valueB), nonce: toBig(nonceB), gasLimit: toBig(gasB), txHash, data: bytesToHex(dataB) }
}

function parseLegacy(txHash: string, raw: Uint8Array): ParsedEvmTx {
  const dec = RLP.decode(raw) as unknown as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array]
  if (dec.length !== 9) throw new Error('tx legacy invalida')
  const [nonceB, gasPriceB, gasB, toB, valueB, dataB, vB, rB, sB] = dec
  if (!rB.length || !sB.length) throw new Error('tx sin firma')
  const to = toEip55(toB)
  if (!to) throw new Error('tx de creacion de contrato no soportada')
  const v = toBig(vB)
  let sigHash: Uint8Array
  let parity: number
  if (v === 27n || v === 28n) {
    parity = v === 28n ? 1 : 0
    sigHash = keccak(RLP.encode([nonceB, gasPriceB, gasB, toB, valueB, dataB] as unknown as Parameters<typeof RLP.encode>[0]))
  } else {
    const chainId = (v - 35n) / 2n
    if (chainId !== BigInt(EVM_CHAIN_ID)) throw new Error(`chainId invalido: se espera ${EVM_CHAIN_ID}`)
    parity = Number(v - 35n - chainId * 2n)
    sigHash = keccak(RLP.encode([nonceB, gasPriceB, gasB, toB, valueB, dataB, chainId, 0n, 0n] as unknown as Parameters<typeof RLP.encode>[0]))
  }
  const from = recoverSender(sigHash, rB, sB, parity)
  return { type: 0, from, to, value: toBig(valueB), nonce: toBig(nonceB), gasLimit: toBig(gasB), txHash, data: bytesToHex(dataB) }
}