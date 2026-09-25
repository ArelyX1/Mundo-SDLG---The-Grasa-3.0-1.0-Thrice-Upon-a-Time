import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateKeypair, addressFromPublicKey } from './core/crypto.js'

export interface Wallet {
  name: string
  address: string
  publicKey: string
  secretKey: string
}

/** Almacén local de llaves (self-host): un JSON por wallet en <dir>/<name>.json */
export class WalletStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  create(name: string): Wallet {
    const kp = generateKeypair()
    const w: Wallet = { name, address: addressFromPublicKey(kp.publicKey), publicKey: kp.publicKey, secretKey: kp.secretKey }
    writeFileSync(this.path(name), JSON.stringify(w, null, 2))
    return w
  }

  get(nameOrAddress: string): Wallet | undefined {
    if (existsSync(this.path(nameOrAddress))) return this.read(nameOrAddress)
    const w = this.readAll().find((x) => x.address === nameOrAddress)
    return w
  }

  byName(name: string): Wallet | undefined {
    return this.readAll().find((w) => w.name === name)
  }

  private read(name: string): Wallet {
    return JSON.parse(readFileSync(this.path(name), 'utf8')) as Wallet
  }

  readAll(): Wallet[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Wallet
        } catch {
          return null
        }
      })
      .filter((w): w is Wallet => w !== null)
  }

  listPublic(): Array<Pick<Wallet, 'name' | 'address' | 'publicKey'>> {
    return this.readAll().map(({ name, address, publicKey }) => ({ name, address, publicKey }))
  }

  private path(name: string): string {
    return join(this.dir, name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json')
  }
}