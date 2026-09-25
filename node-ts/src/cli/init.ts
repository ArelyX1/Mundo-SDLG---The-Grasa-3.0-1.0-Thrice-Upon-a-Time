import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { generateKeypair, addressFromPublicKey } from '../core/crypto.js'
import type { GenesisConfig } from '../genesis.js'
import type { Wallet } from '../wallet.js'

export interface InitOptions {
  network: string
  outDir: string
  validators: number
  users: number
  timeslotSecs: number
  cores: number
  seedPeers: string[]
  maxSupply: string
  issuerBalance: string
  validatorBalance: string
  userBalance: string
}

export function runInit(opts: InitOptions): { genesis: GenesisConfig; wallets: Wallet[] } {
  const validators: GenesisConfig['validators'] = []
  const wallets: Wallet[] = []
  const walletDir = join(opts.outDir, '..', 'wallets')

  const makeWallet = (name: string): Wallet => {
    const kp = generateKeypair()
    return { name, address: addressFromPublicKey(kp.publicKey), publicKey: kp.publicKey, secretKey: kp.secretKey }
  }

  for (let i = 0; i < opts.validators; i++) {
    const w = makeWallet(`validator-${i}`)
    validators.push({ name: w.name, publicKey: w.publicKey })
    wallets.push(w)
  }
  for (let i = 0; i < opts.users; i++) {
    wallets.push(makeWallet(`user-${i}`))
  }
  const issuer = makeWallet('issuer')
  wallets.push(issuer)

  const initialBalances: Record<string, string> = {}
  initialBalances[issuer.address] = opts.issuerBalance
  for (const v of validators) {
    const w = wallets.find((x) => x.publicKey === v.publicKey)!
    initialBalances[w.address] = opts.validatorBalance
  }
  for (const w of wallets.filter((x) => x.name.startsWith('user-'))) {
    initialBalances[w.address] = opts.userBalance
  }

  const genesis: GenesisConfig = {
    network: opts.network,
    timeslotSecs: opts.timeslotSecs,
    cores: opts.cores,
    createdAt: new Date().toISOString(),
    epochStart: Date.now(),
    validators,
    seedPeers: opts.seedPeers,
    economy: { maxSupply: opts.maxSupply, decimals: 12, issuer: issuer.address, initialBalances },
  }

  mkdirSync(opts.outDir, { recursive: true })
  mkdirSync(walletDir, { recursive: true })
  writeFileSync(join(opts.outDir, 'genesis.json'), JSON.stringify(genesis, null, 2))
  for (const w of wallets) writeFileSync(join(walletDir, w.name + '.json'), JSON.stringify(w, null, 2))

  return { genesis, wallets }
}

export function writeEnvExample(dir: string): void {
  const p = join(dir, '.env.example')
  if (existsSync(p)) return
  writeFileSync(
    p,
    [
      'JAM_NETWORK=sdlg-jam',
      'JAM_NODE_NAME=validator-0',
      'JAM_DATA_DIR=./data',
      'JAM_GENESIS=./genesis/genesis.json',
      'JAM_WALLET_DIR=./wallets',
      'JAM_P2P_PORT=30334',
      'JAM_RPC_PORT=9944',
      'JAM_API_PORT=8080',
      'JAM_EVM_PORT=8545',
      'JAM_SEED_PEERS=',
      'JAM_LISTEN_ALL=false',
      'JAM_TIMESLOT_SECS=6',
    ].join('\n'),
  )
}