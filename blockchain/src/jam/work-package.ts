import { blakeHex, verifyString, bytesToHex } from '../core/crypto.js'
import { publicKeyFromAddress, isValidAddress } from '../core/crypto.js'
import type { Hex } from '../core/types.js'

/** Entrada de un work package (transaccion-ish). */
export interface WorkItem {
  id: Hex
  serviceId: number
  method: string
  params: Record<string, string | number | boolean>
  sender: string
  nonce: number
  signature: Hex
  memo?: string
}

/** Salida normalizada de refine(): lista para accumulate. */
export interface WorkOutput {
  op: string
  [k: string]: unknown
}

/** Salida determinista de refine() por work item. */
export interface WorkResult {
  itemId: Hex
  ok: boolean
  output?: WorkOutput
  error?: string
  gasUsed: number
}

/** Work package: un conjunto de work items para un core concreto. */
export interface WorkPackage {
  slot: number
  core: number
  author: string
  items: WorkItem[]
  hash: Hex
}

/** Reporte de refine: lo que se incluye en el bloque para el accumulate. */
export interface WorkReport {
  core: number
  author: string
  packageHash: Hex
  items: WorkItem[]
  results: WorkResult[]
}

export function itemSignPayload(item: Omit<WorkItem, 'id' | 'signature'>): string {
  return JSON.stringify({
    serviceId: item.serviceId,
    method: item.method,
    params: item.params,
    sender: item.sender,
    nonce: item.nonce,
    memo: item.memo ?? null,
  })
}

export function computeItemId(item: Omit<WorkItem, 'id' | 'signature'>): Hex {
  return blakeHex(itemSignPayload(item))
}

export function verifyItemSignature(item: WorkItem): boolean {
  if (!isValidAddress(item.sender)) return false
  const pub = publicKeyFromAddress(item.sender)
  return verifyString(pub, item.signature, itemSignPayload(item))
}

export function workPackageHash(slot: number, core: number, author: string, items: WorkItem[]): Hex {
  return blakeHex(JSON.stringify({ slot, core, author, items }))
}

export function reportToPackage(r: WorkReport): WorkPackage {
  return { slot: 0, core: r.core, author: r.author, items: r.items, hash: r.packageHash }
}

export function hex(x: Uint8Array): string {
  return bytesToHex(x)
}