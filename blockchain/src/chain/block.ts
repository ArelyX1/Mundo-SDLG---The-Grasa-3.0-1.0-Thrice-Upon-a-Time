import { blakeHex } from '../core/crypto.js'
import type { Hex } from '../core/types.js'
import type { WorkReport } from '../jam/work-package.js'

export interface BlockHeader {
  network: string
  timeslot: number
  parentHash: Hex
  stateRoot: Hex
  bodyHash: Hex
  author: Hex
  core: number
}

export interface Block {
  header: BlockHeader
  body: { reports: WorkReport[] }
  signature: Hex
  hash: Hex
}

export function hashBody(body: Block['body']): Hex {
  return blakeHex(JSON.stringify(body))
}

/** Hash del bloque: cabecera + firma (determinista y verificable). */
export function hashBlock(header: BlockHeader, signature: Hex): Hex {
  return blakeHex(JSON.stringify({ h: header, s: signature }))
}

export const ZERO_HASH = '0'.repeat(64)

export function isGenesisBlock(block: Block): boolean {
  return block.header.timeslot === 0 && block.header.parentHash === ZERO_HASH
}