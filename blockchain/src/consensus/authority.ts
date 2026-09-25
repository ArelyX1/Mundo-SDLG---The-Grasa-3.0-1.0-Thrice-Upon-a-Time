import type { Block } from '../chain/block.js'
import { verifyString, addressFromPublicKey, publicKeyFromAddress, isValidAddress } from '../core/crypto.js'
import type { GenesisValidator } from '../genesis.js'

/**
 * Consenso de autoridad (PoA).
 * Sustituto minimo de Safrole: el Gray Paper define Safrole como el esquema
 * de finalidad de JAM; aqui el lider prodigue por rotacion determinista.
 */
export class AuthoritySet {
  constructor(private readonly validators: GenesisValidator[]) {
    if (validators.length === 0) throw new Error('AuthoritySet vacio')
  }

  addresses(): string[] {
    return this.validators.map((v) => addressFromPublicKey(v.publicKey))
  }

  members(): GenesisValidator[] {
    return [...this.validators]
  }

  leaderPublicKey(slot: number): string {
    const idx = slot % this.validators.length
    return this.validators[idx]!.publicKey
  }

  leaderAddress(slot: number): string {
    return addressFromPublicKey(this.leaderPublicKey(slot))
  }

  isLeader(publicKey: string, slot: number): boolean {
    return this.leaderPublicKey(slot) === publicKey
  }

  isValidAuthor(publicKey: string, slot: number): boolean {
    return this.validators.some((v) => v.publicKey === publicKey)
  }

  verifyBlockSignature(block: Block): boolean {
    if (!isValidAddress(block.header.author)) return false
    if (!this.isLeader(publicKeyFromAddress(block.header.author), block.header.timeslot)) return false
    const pub = publicKeyFromAddress(block.header.author)
    const msg = JSON.stringify({ h: block.header })
    return verifyString(pub, block.signature, msg)
  }
}

export function leaderIndex(slot: number, len: number): number {
  return ((slot % len) + len) % len
}