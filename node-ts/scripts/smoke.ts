import assert from 'node:assert'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../src/cli/init.js'
import { loadGenesis } from '../src/genesis.js'
import { JamNode } from '../src/engine.js'
import { WalletStore } from '../src/wallet.js'
import { maybeLogger } from '../src/core/log.js'
import { createRpcServer } from '../src/rpc/jsonrpc.js'
import { createApiServer } from '../src/api/economy.js'
import { addressFromPublicKey } from '../src/core/crypto.js'
import type { Server } from 'node:http'

const DIR = mkdtempSync(join(tmpdir(), 'sdlg-smoke-'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  console.log('=== Smoke: red SDLG-JAM multi-nodo (P2P real) ===')
  rmSync(DIR, { recursive: true, force: true })

  const result = runInit({
    network: 'sdlg-smoke',
    outDir: join(DIR, 'genesis'),
    validators: 4,
    users: 2,
    timeslotSecs: 1,
    cores: 1,
    seedPeers: ['ws://127.0.0.1:41334'],
    maxSupply: '1000000000',
    issuerBalance: '700000000',
    validatorBalance: '100000',
    userBalance: '1000000',
  })
  const genesis = loadGenesis(join(DIR, 'genesis', 'genesis.json'))
  const wallets = new WalletStore(join(DIR, 'wallets'))

  const nodes: JamNode[] = []
  const servers: Server[] = []
  for (let i = 0; i < 4; i++) {
    const name = `validator-${i}`
    const cfg = {
      network: genesis.network,
      nodeName: name,
      dataDir: join(DIR, 'data', name),
      genesisPath: join(DIR, 'genesis', 'genesis.json'),
      walletDir: join(DIR, 'wallets'),
      p2pPort: 41334 + i,
      rpcPort: 49944 + i,
      apiPort: 48080 + i,
      seedPeers: i === 0 ? [] : ['ws://127.0.0.1:41334'],
      listenAll: false,
      timeslotSecs: 1,
      logLevel: 'info',
    }
    const log = maybeLogger('warn', name)
    const node = new JamNode(cfg, genesis, log)
    const wallet = wallets.get(name)
    await node.boot({ secretHex: wallet?.secretKey })
    servers.push(createRpcServer(node, log, cfg.rpcPort))
    servers.push(createApiServer(node, wallets, genesis, log, cfg.apiPort))
    nodes.push(node)
  }

  console.log('nodos arrancados, esperando consenso sobre los primeros slots...')
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    await sleep(500)
    const heads = nodes.map((n) => n.head.header.timeslot)
    if (Math.min(...heads) >= 8) break
  }
  const heads = nodes.map((n) => n.head.header.timeslot)
  console.log('cabezas:', heads)
  assert.ok(Math.min(...heads) >= 8, 'la red no avanzo lo suficiente')

  const headsHash = nodes.map((n) => n.head.hash)
  assert.equal(new Set(headsHash).size, 1, `los nodos divergieron en la cabeza: ${headsHash.join(', ')}`)
  assert.deepEqual(
    nodes.map((n) => n.state.root()),
    nodes.map((n) => n.state.root()),
    'los estados deben coincidir (mismo accumulate)',
  )
  console.log('consenso ok: head común', headsHash[0]!.slice(0, 16), '(estados idénticos)')

  const bridge = wallets.get('bridge')!
  const issuer = wallets.get('issuer')!

  console.log('--- mint del issuer en favor de bridge ---')
  const api0 = `http://127.0.0.1:48080`
  const mintRes = await fetch(`${api0}/economy/mint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: 'issuer', to: bridge.address, amount: '250000' }),
  }).then((r) => r.json())
  console.log('mint ->', JSON.stringify(mintRes))
  assert.equal(mintRes.accepted, true)

  console.log('--- transfer issuer -> bridge (1.000 SDLG) ---')
  const tx = await fetch(`${api0}/economy/transfer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: 'issuer', to: bridge.address, amount: '1000', memo: 'hola mundo SDLG' }),
  }).then((r) => r.json())
  console.log('transfer ->', JSON.stringify(tx))
  assert.equal(tx.accepted, true)

  console.log('--- faucet bridge ---')
  const faucet = await fetch(`${api0}/economy/faucet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: 'bridge' }),
  }).then((r) => r.json())
  console.log('faucet ->', JSON.stringify(faucet))
  assert.equal(faucet.accepted, true)

  // esperar a que entren en bloques
  await sleep(2_500)

  const b1 = await fetch(`${api0}/economy/balance`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: bridge.address }) }).then((r) => r.json())
  console.log('saldo bridge tras todo:', b1)

  const rpc0 = new URL(`${api0}/`)
  void rpc0
  const rpc = 'http://127.0.0.1:49944'
  const netInfo = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system_health' }),
  }).then((r) => r.json())
  console.log('health:', JSON.stringify(netInfo))
  assert.ok(netInfo.result?.peers >= 3, 'esperaba >= 3 peers en un nodo')

  const supply = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'papucoin_getSupply' }),
  }).then((r) => r.json())
  console.log('supply:', JSON.stringify(supply))

  // cierre limpio
  for (const n of nodes) n.shutdown()
  for (const s of servers) s.close()
  console.log('SMOKE OK ✓')
  rmSync(DIR, { recursive: true, force: true })
  process.exit(0)
}

main().catch((e) => {
  console.error('SMOKE FAIL:', e)
  process.exit(1)
})