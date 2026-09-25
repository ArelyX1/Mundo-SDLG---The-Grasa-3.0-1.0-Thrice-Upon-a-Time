import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { JamNode } from '../engine.js'
import type { Logger } from '../core/log.js'
import { addressFromPublicKey } from '../core/crypto.js'
import { rawToDisplay } from '../services/papucoin/service.js'
import type { WorkItem } from '../jam/work-package.js'

type Handler = (params: unknown) => Promise<unknown> | unknown

export function createRpcServer(node: JamNode, log: Logger, port: number): Server {
  const as = (p: unknown): Record<string, unknown> => (p ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => String(v ?? '')
  const num = (v: unknown): number => Number(v)

  const methods: Record<string, Handler> = {
    system_health: async () => ({
      network: node.cfg.network,
      node: node.cfg.nodeName,
      peers: node.peerCount(),
      head: node.head.header.timeslot,
      stateRoot: node.state.root(),
      mempool: node.mempoolSize(),
    }),
    system_version: async () => ({ name: 'sdlg-jam', version: '0.1.0', protocol: 'JAM (Join-Accumulate Machine)' }),
    network_peers: async () => node.gossipPeers(),
    chain_getHead: async () => node.head,
    chain_getBlock: async (p) => {
      const n = num(as(p).slot)
      const b = node.store.getBySlot(n)
      if (!b) throw new Error(`bloque ${n} no encontrado`)
      return b
    },
    chain_getStateRoot: async () => ({ root: node.state.root(), head: node.head.header.timeslot }),
    chain_getTimeslot: async () => ({ now: Date.now(), slot: node.head.header.timeslot }),
    jam_getValidators: async () => node.genesis.validators.map((v) => ({ name: v.name, publicKey: v.publicKey, address: addressFromPublicKey(v.publicKey) })),
    jam_getServices: async () => node.state.getJSON('system/services'),
    jam_getCores: async () => ({ cores: node.genesis.cores, timeslotSecs: node.cfg.timeslotSecs }),
    papucoin_getAccounts: () => node.listAccounts(),
    papucoin_getBalance: (p) => {
      const address = str(as(p).address)
      const raw = node.balanceOf(address)
      return { address, balanceRaw: raw.toString(), balance: rawToDisplay(raw) }
    },
    papucoin_getNonce: (p) => ({ address: str(as(p).address), nonce: node.nonceOf(str(as(p).address)).toString() }),
    papucoin_getConfig: async () => node.economyConfig(),
    papucoin_getSupply: async () => {
      const raw = node.supply()
      return { supplyRaw: raw.toString(), supply: rawToDisplay(raw) }
    },
    papucoin_getEvents: (p) => node.eventsLatest(num(as(p).n || 20)),
    jam_submitWork: (p) => {
      const item = p as WorkItem
      const r = node.submitWorkItem(item, true)
      if (!r.accepted) throw new Error(r.reason ?? 'rechazado')
      return { accepted: true, itemId: item.id }
    },
    jam_mempool: async () => ({ size: node.mempoolSize() }),
  }

  const server = createServer((req, res) => {
    let acc = ''
    req.on('data', (c) => (acc += c))
    req.on('end', async () => {
      let id: string | number | null = null
      let status = 200
      let payload: unknown
      try {
        const body = JSON.parse(acc || '{}')
        id = body.id ?? null
        const method = methods[body.method as string]
        if (!method) throw new Error(`metodo desconocido: ${body.method}`)
        const result = await method(body.params)
        payload = { jsonrpc: '2.0', id, result }
      } catch (e) {
        status = 200
        payload = {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        }
      }
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  server.listen(port)
  log.info(`JSON-RPC escuchando en http://127.0.0.1:${port}`)
  return server
}