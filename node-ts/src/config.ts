import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function env(key: string): string | undefined {
  const v = process.env[key]
  return v === undefined || v === '' ? undefined : v
}

export interface NodeConfig {
  network: string
  nodeName: string
  dataDir: string
  genesisPath: string
  walletDir: string
  p2pPort: number
  rpcPort: number
  apiPort: number
  evmPort: number
  /** The node that owns the chain. The EVM surface is a door onto it. */
  upstream: string
  seedPeers: string[]
  listenAll: boolean
  timeslotSecs: number
  logLevel: string
  secretHex?: string
}

export function loadConfig(overrides: Partial<NodeConfig> = {}): NodeConfig {
  const genesisPath = env('JAM_GENESIS') ?? './genesis/genesis.json'
  if (!existsSync(resolve(genesisPath))) {
    throw new Error(
      `No existe el genesis en ${genesisPath}. Generalo primero con: npm run dev -- init --out ./genesis`,
    )
  }
  const config: NodeConfig = {
    network: env('JAM_NETWORK') ?? 'sdlg-jam',
    nodeName: env('JAM_NODE_NAME') ?? 'validator-0',
    dataDir: env('JAM_DATA_DIR') ?? './data',
    genesisPath,
    walletDir: env('JAM_WALLET_DIR') ?? './wallets',
    p2pPort: parseInt(env('JAM_P2P_PORT') ?? '30334', 10),
    rpcPort: parseInt(env('JAM_RPC_PORT') ?? '9944', 10),
    apiPort: parseInt(env('JAM_API_PORT') ?? '8080', 10),
    evmPort: parseInt(env('JAM_EVM_PORT') ?? '8545', 10),
    upstream: env('JAM_UPSTREAM_RPC') ?? 'http://127.0.0.1:9944',
    seedPeers: (env('JAM_SEED_PEERS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    listenAll: (env('JAM_LISTEN_ALL') ?? 'false') === 'true',
    timeslotSecs: parseInt(env('JAM_TIMESLOT_SECS') ?? '6', 10),
    logLevel: env('JAM_LOG_LEVEL') ?? 'info',
    secretHex: env('JAM_SECRET'),
  }
  return { ...config, ...overrides }
}