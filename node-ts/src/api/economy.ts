import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { JamNode } from '../engine.js'
import type { WalletStore } from '../wallet.js'
import type { Logger } from '../core/log.js'
import { buildWorkItem, rawToDisplay, PAPUCOIN } from '../services/papucoin/service.js'
import { addressFromPublicKey, isValidAddress } from '../core/crypto.js'
import { isEvmAddress } from '../evm/evm.js'
import type { GenesisConfig } from '../genesis.js'

type Json = Record<string, unknown>
type Handler = (body: Json, query: URLSearchParams, wallet?: import('../wallet.js').Wallet) => Promise<Json> | Json

const anyAddr = (a: string): boolean => isValidAddress(a) || isEvmAddress(a)

export function createApiServer(node: JamNode, walletStore: WalletStore, genesis: GenesisConfig, log: Logger, port: number): Server {
  const respond = (res: import('node:http').ServerResponse, status: number, data: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(data))
  }

  const handlers: Record<string, Handler> = {
    health: async () => ({ ok: true, node: node.cfg.nodeName, head: node.head.header.timeslot, peers: node.peerCount() }),

    info: async () => {
      const cfg = node.economyConfig()
      return {
        network: node.cfg.network,
        name: cfg?.name ?? PAPUCOIN.name,
        symbol: cfg?.symbol ?? PAPUCOIN.symbol,
        decimals: cfg?.decimals ?? PAPUCOIN.decimals,
        maxSupplyRaw: cfg?.maxSupplyRaw ?? PAPUCOIN.maxSupply.toString(),
        maxSupply: rawToDisplay(cfg?.maxSupplyRaw ?? PAPUCOIN.maxSupply),
        issuer: cfg?.issuer ?? null,
        cores: genesis.cores,
        timeslotSecs: node.cfg.timeslotSecs,
        validators: genesis.validators.map((v) => ({ name: v.name, address: addressFromPublicKey(v.publicKey) })),
      }
    },

    balance: async (body) => {
      const addr = String(body.address ?? '')
      if (!anyAddr(addr)) return { error: 'direccion invalida' }
      const raw = node.balanceOf(addr)
      return { address: addr, balanceRaw: raw.toString(), balance: rawToDisplay(raw) }
    },

    nonce: async (body) => {
      const addr = String(body.address ?? '')
      if (!anyAddr(addr)) return { error: 'direccion invalida' }
      return { address: addr, nonce: node.nonceOf(addr).toString() }
    },

    supply: async () => {
      const raw = node.supply()
      return { supplyRaw: raw.toString(), supply: rawToDisplay(raw) }
    },

    network: async () => ({
      head: node.head.header.timeslot,
      stateRoot: node.state.root(),
      peers: node.peerCount(),
      mempool: node.mempoolSize(),
      validators: genesis.validators.map((v) => ({ name: v.name, address: addressFromPublicKey(v.publicKey) })),
    }),

    events: async (body) => ({
      events: node.eventsLatest(Number(body.n ?? 20)).map((e) => ({
        ...e,
        amount: e.amount ? rawToDisplay(e.amount) : null,
        fee: e.fee ? rawToDisplay(e.fee) : null,
      })),
    }),

    wallets: async () => ({ wallets: walletStore.listPublic() }),

    accounts: async () => ({
      accounts: node.listAccounts(),
      wallets: walletStore.listPublic(),
    }),

    transfer: async (body, _q, wallet) => {
      const to = String(body.to ?? '')
      const amount = String(body.amount ?? '')
      if (!wallet) return { accepted: false, error: 'wallet no encontrada' }
      if (!anyAddr(to)) return { accepted: false, error: 'direccion destino invalida' }
      const nonce = Number(node.nonceOf(wallet.address))
      const item = buildWorkItem(wallet.secretKey, wallet.address, 'transfer', { to, amount }, nonce, (body.memo as string) ?? '')
      const r = node.submitWorkItem(item, true)
      if (!r.accepted) return { accepted: false, error: r.reason }
      return { accepted: true, itemId: item.id, from: wallet.address, to, amount, amountRaw: item.params.amount, nonce }
    },

    mint: async (body, _q, wallet) => {
      const to = String(body.to ?? '')
      const amount = String(body.amount ?? '')
      if (!wallet) return { accepted: false, error: 'wallet no encontrada' }
      if (!anyAddr(to)) return { accepted: false, error: 'direccion destino invalida' }
      const nonce = Number(node.nonceOf(wallet.address))
      const item = buildWorkItem(wallet.secretKey, wallet.address, 'mint', { to, amount }, nonce)
      const r = node.submitWorkItem(item, true)
      if (!r.accepted) return { accepted: false, error: r.reason }
      return { accepted: true, itemId: item.id, by: wallet.address, to, amountRaw: item.params.amount }
    },

    burn: async (body, _q, wallet) => {
      const amount = String(body.amount ?? '')
      if (!wallet) return { accepted: false, error: 'wallet no encontrada' }
      const nonce = Number(node.nonceOf(wallet.address))
      const item = buildWorkItem(wallet.secretKey, wallet.address, 'burn', { amount }, nonce)
      const r = node.submitWorkItem(item, true)
      if (!r.accepted) return { accepted: false, error: r.reason }
      return { accepted: true, itemId: item.id, by: wallet.address, amountRaw: item.params.amount }
    },

    faucet: async (body) => {
      const addr = String(body.address ?? body.wallet ?? '')
      const wallet = walletStore.get(addr)
      if (!wallet) return { accepted: false, error: `no existe wallet para ${addr}` }
      const nonce = Number(node.nonceOf(wallet.address))
      const item = buildWorkItem(wallet.secretKey, wallet.address, 'faucet', {}, nonce)
      const r = node.submitWorkItem(item, true)
      if (!r.accepted) return { accepted: false, error: r.reason }
      return { accepted: true, itemId: item.id, to: wallet.address, amountRaw: PAPUCOIN.faucetAmount.toString() }
    },
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/^\/|\/$/g, '')
    if (path === '') {
      respond(res, 200, { service: `${PAPUCOIN.name} (${PAPUCOIN.symbol})`, api: '/economy', endpoints: Object.keys(handlers) })
      return
    }
    if (path === 'openapi') {
      respond(res, 200, { openapi: '3.0.0', info: { title: `${PAPUCOIN.name} Economy API`, version: '0.1.0' }, paths: { '/economy/transfer': { post: { summary: `Enviar ${PAPUCOIN.symbol}` } } } })
      return
    }
    if (path === 'health') {
      respond(res, 200, { ok: true, node: node.cfg.nodeName, head: node.head.header.timeslot, stateRoot: node.state.root() })
      return
    }
    const m = /^economy\/(.*)$/.exec(path)
    if (!m) {
      respond(res, 404, { error: 'no encontrado' })
      return
    }
    const op = m[1]!
    const handler = handlers[op]
    if (!handler) {
      respond(res, 404, { error: `operacion desconocida: ${op}` })
      return
    }
    let acc = ''
    req.on('data', (c) => (acc += c))
    req.on('end', async () => {
      try {
        const body: Json = acc ? JSON.parse(acc) : {}
        const walletName = String(body.wallet ?? '')
        const wallet = walletName ? walletStore.get(walletName) : undefined
        if (walletName && !wallet) {
          respond(res, 400, { error: `wallet "${walletName}" no encontrada en wallets/` })
          return
        }
        const result = await handler(body, url.searchParams, wallet)
        respond(res, 200, result)
      } catch (e) {
        respond(res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
    })
  })

  server.listen(port)
  log.info(`${PAPUCOIN.name} API escuchando en http://127.0.0.1:${port}`)
  return server
}