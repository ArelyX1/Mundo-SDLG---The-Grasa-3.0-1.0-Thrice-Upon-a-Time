#!/usr/bin/env node
import { maybeLogger } from '../core/log.js'
import { loadConfig } from '../config.js'
import { loadGenesis } from '../genesis.js'
import { JamNode } from '../engine.js'
import { WalletStore } from '../wallet.js'
import { createRpcServer } from '../rpc/jsonrpc.js'
import { createApiServer } from '../api/economy.js'
import { createEvmServer } from '../api/evm.js'
import { runInit } from './init.js'
import { runConsole } from './console.js'
import { generateKeypair, addressFromPublicKey } from '../core/crypto.js'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

interface Flags {
  [k: string]: string | true
}

function parseFlags(argv: string[]): { command: string; flags: Flags; rest: string[] } {
  const command = argv[2] ?? 'help'
  const flags: Flags = {}
  const rest: string[] = []
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1)
      else {
        const next = argv[i + 1]
        if (next && !next.startsWith('--')) {
          flags[a.slice(2)] = next
          i++
        } else flags[a.slice(2)] = true
      }
    } else rest.push(a)
  }
  return { command, flags, rest }
}

function number(flags: Flags, key: string, def: number): number {
  const v = flags[key]
  if (typeof v === 'boolean' || v === undefined) return def
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

function help(): void {
  console.log(
    [
      'SDLG-JAM — red blockchain JAM con economia CRYPTOPAPU (PAPU)',
      '',
      'USO:',
      '  jam-node init   -> genera genesis.json + wallets (red local o servidor)',
      '  jam-node start  -> arranca un nodo (valida y autor bloques)',
      '  jam-node keygen -> genera una llave suelta',
      '  jam-node wallets-> lista wallets locales',
      '  jam-node console-> consola de economia (balance, transfer, mint, faucet)',
      '',
      'Ejemplos:',
      '  npm run dev -- init --net sdlg-jam --validators 4 --users 3 --out ./genesis --seed ws://127.0.0.1:30334',
      '  npm run dev -- start --node validator-0 --port 30334 --rpc 9944 --api 8080',
      '  npm run dev -- console',
      '',
      'Variables de entorno: ver .env.example',
    ].join('\n'),
  )
}

async function main(): Promise<void> {
  const { command, flags } = parseFlags(process.argv)

  switch (command) {
    case 'init': {
      if (flags['help'] === true || flags['h'] === true) {
        help()
        return
      }
      const genPath = join(String(flags['out'] ?? './genesis'), 'genesis.json')
      if (existsSync(genPath) && flags['force'] !== true) {
        console.error(`ERROR: ya existe ${genPath}. Si de verdad quieres regenerar claves/genesis, ejecuta con --force (cuidado: reinicia la red y cambia los validadores).`)
        process.exit(1)
      }
      const seeds = (flags['seed'] as string | undefined) ?? ''
      const baseSeed = seeds.split(',').map((s) => s.trim()).filter(Boolean)
      const outDir = String(flags['out'] ?? './genesis')
      const walletDir = join(outDir, '..', 'wallets')
      const result = runInit({
        network: String(flags['net'] ?? 'sdlg-jam'),
        outDir,
        validators: number(flags, 'validators', 4),
        users: number(flags, 'users', 3),
        timeslotSecs: number(flags, 'timeslot', 6),
        cores: number(flags, 'cores', 1),
        seedPeers: baseSeed,
        maxSupply: String(flags['max-supply'] ?? '1000000000'),
        issuerBalance: String(flags['issuer-balance'] ?? '700000000'),
        validatorBalance: String(flags['validator-balance'] ?? '100000'),
        userBalance: String(flags['user-balance'] ?? '1000000'),
      })
      const { genesis, wallets } = result
      console.log('\nRed ', genesis.network, 'preparada:')
      console.log('  genesis        ->', outDir + '/genesis.json')
      console.log(`  validators     -> ${genesis.validators.length} (wallets en ${walletDir})`)
      console.log(`  usuarios       -> ${wallets.filter((w) => w.name.startsWith('user-')).length}`)
      console.log(`  emisor (mint)  -> issuer (llave en ${walletDir}/issuer.json)`)
      console.log(`  max supply     -> ${genesis.economy.maxSupply} PAPU`)
      console.log('  seed peers     ->', genesis.seedPeers.join(', ') || '(usa --seed ws://host:puerto)')
      console.log('\nSiguiente paso -> arrancar nodos:')
      console.log('  1. npm install && npm run build')
      if (genesis.seedPeers.length) console.log('  2. npm start -- start --node validator-0 --data ./data/v0')
      console.log('  Red local completa: ver scripts/local-demo.sh y docker-compose.yml')
      return
    }

    case 'start': {
      const overrides = {
        nodeName: String(flags['node'] ?? process.env.JAM_NODE_NAME ?? 'validator-0'),
        genesisPath: String(flags['genesis'] ?? process.env.JAM_GENESIS ?? './genesis/genesis.json'),
        dataDir: String(flags['data'] ?? process.env.JAM_DATA_DIR ?? './data'),
        walletDir: String(flags['wallets'] ?? process.env.JAM_WALLET_DIR ?? './wallets'),
        p2pPort: number(flags, 'port', parseInt(process.env.JAM_P2P_PORT ?? '30334', 10)),
        rpcPort: number(flags, 'rpc', parseInt(process.env.JAM_RPC_PORT ?? '9944', 10)),
        apiPort: number(flags, 'api', parseInt(process.env.JAM_API_PORT ?? '8080', 10)),
        evmPort: number(flags, 'evm', parseInt(process.env.JAM_EVM_PORT ?? '8545', 10)),
        // La cadena que manda. Esta puerta no decide ningun bloque: lee de ahi.
        upstream: String(flags['upstream'] ?? process.env.JAM_UPSTREAM_RPC ?? 'http://127.0.0.1:9944'),
        listenAll: flags['listen-all'] === true || flags['listen-all'] === 'true' || process.env.JAM_LISTEN_ALL === 'true',
        timeslotSecs: number(flags, 'timeslot', parseInt(process.env.JAM_TIMESLOT_SECS ?? '6', 10)),
        seedPeers: (String(flags['seed'] ?? process.env.JAM_SEED_PEERS ?? '')).split(',').map((s) => s.trim()).filter(Boolean),
      }
      const cfg = loadConfig(overrides)
      const genesis = loadGenesis(cfg.genesisPath)
      const log = maybeLogger(cfg.logLevel as never, cfg.nodeName)

      const walletStore = new WalletStore(cfg.walletDir)
      const wallet = walletStore.get(cfg.nodeName)
      if (!wallet && cfg.nodeName === 'validator-0') {
        log.warn(`no hay wallet "${cfg.nodeName}"; el nodo queda solo sincronizando`)
      }

      const node = new JamNode(cfg, genesis, log)
      await node.boot({ secretHex: wallet?.secretKey, p2pSeeds: cfg.seedPeers })
      createRpcServer(node, log, cfg.rpcPort)
      createApiServer(node, walletStore, genesis, log, cfg.apiPort)
      // La superficie EVM es una puerta al nodo de node-go, no una segunda
      // cadena: este proceso no firma niun item ni decide ningun bloque.
      createEvmServer(cfg.upstream, log, cfg.evmPort)

      const shutdown = () => {
        node.shutdown()
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      return
    }

    case 'gateway': {
      // Solo la puerta. No hay cadena aqui, ni claves, ni validadores.
      const upstream = String(flags['upstream'] ?? process.env.JAM_UPSTREAM_RPC ?? 'http://127.0.0.1:9944')
      const evmPort = number(flags, 'evm', parseInt(process.env.JAM_EVM_PORT ?? '8545', 10))
      const log = maybeLogger((String(flags['log-level'] ?? process.env.JAM_LOG_LEVEL ?? 'info')) as never, 'gateway')

      try {
        const probe = await fetch(`${upstream.replace(/\/$/, '')}/jam_getHeader`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'jam_getHeader', params: [] }),
        })
        if (!probe.ok) throw new Error(`HTTP ${probe.status}`)
      } catch (e) {
        log.error(`no se pudo hablar con el nodo en ${upstream}: ${e instanceof Error ? e.message : String(e)}`)
        log.error('levanta node-go primero (go run -tags dev ./cmd/strawberry) o corrige --upstream')
        process.exit(1)
      }

      createEvmServer(upstream, log, evmPort)
      log.info(`MetaMask: agrega la red con rpc ${upstream.replace(/\/$/, '')} -> http://127.0.0.1:${evmPort}`)
      const shutdown = () => process.exit(0)
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      return
    }

    case 'keygen': {
      const kp = generateKeypair()
      const addr = addressFromPublicKey(kp.publicKey)
      const name = String(flags['name'] ?? 'unnamed')
      if (flags['out']) {
        const dir = String(flags['out'])
        mkdirSync(dir, { recursive: true })
        const file = join(dir, name + '.json')
        if (!existsSync(file)) {
          writeFileSync(file, JSON.stringify({ name, address: addr, publicKey: kp.publicKey, secretKey: kp.secretKey }, null, 2))
          console.log('guardada en', file)
        } else console.log('ya existe', file)
      }
      console.log(JSON.stringify({ name, address: addr, publicKey: kp.publicKey, secretKey: kp.secretKey }, null, 2))
      return
    }

    case 'wallets': {
      const dir = String(flags['wallets'] ?? process.env.JAM_WALLET_DIR ?? './wallets')
      const store = new WalletStore(dir)
      console.log(JSON.stringify(store.listPublic(), null, 2))
      return
    }

    case 'console': {
      const rpc = `http://127.0.0.1:${number(flags, 'rpc', parseInt(process.env.JAM_RPC_PORT ?? '9944', 10))}`
      const api = `http://127.0.0.1:${number(flags, 'api', parseInt(process.env.JAM_API_PORT ?? '8080', 10))}`
      await runConsole({ rpc, api })
      return
    }

    case 'help':
    default:
      help()
      return
  }
}

main().catch((e) => {
  console.error('Error:', e instanceof Error ? e.message : e)
  process.exit(1)
})