import { JamNode } from '../src/engine.js'
import { loadGenesis, networkEpochStart } from '../src/genesis.js'
import { maybeLogger } from '../src/core/log.js'
import { slotAt } from '../src/core/types.js'
import { readFileSync, rmSync } from 'node:fs'

const GATE = Number(process.env.SYNC_GATE ?? 0)

function liveSlot(genesis: ReturnType<typeof loadGenesis>): number {
  return slotAt(Date.now(), networkEpochStart(genesis), genesis.timeslotSecs)
}

async function main() {
  const walletName = process.argv[2] ?? ''
  const seed = process.argv[3] ?? 'ws://127.0.0.1:30334'
  const dataDir = `/tmp/opencode/synctest-${walletName || 'observer'}`
  rmSync(dataDir, { recursive: true, force: true })
  const genesis = loadGenesis('genesis/genesis.json')
  const log = maybeLogger(process.env.JAM_LOG_LEVEL ?? 'info', 'sync-test')
  const node = new JamNode(
    { network: 'sdlg-jam', nodeName: walletName || 'observer', dataDir, p2pPort: 40444, rpcPort: 49945, apiPort: 40809, listenAll: false },
    genesis,
    log,
  )
  await node.boot({
    secretHex: walletName ? JSON.parse(readFileSync(`wallets/${walletName}.json`, 'utf8')).secretKey : undefined,
    p2pSeeds: [seed],
  })
  const target = GATE || liveSlot(genesis)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const h = node.head.header.timeslot
    log.info(`head=${h} stateRoot=${node.state.root().slice(0, 16)} peers=${node.peerCount()} target=${target}`)
    const live = liveSlot(genesis)
    if (h >= Math.max(target, live - 2)) {
      log.info('SINCRONIZADO y en vivo')
    }
    if (h >= Math.max(target, live - 2) && i > 3) break
  }
  node.shutdown()
  process.exit(0)
}

main().catch((e) => {
  console.error('SYNCTEST FAIL', e)
  process.exit(1)
})