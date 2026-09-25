import { WebSocketServer, WebSocket } from 'ws'
import type { Block } from '../chain/block.js'
import type { WorkItem } from '../jam/work-package.js'
import type { Logger } from '../core/log.js'

export type NetMessage =
  | { t: 'hello'; network: string; node: string; slot: number }
  | { t: 'block'; block: Block; node?: string }
  | { t: 'work'; item: WorkItem; node?: string }
  | { t: 'sync-req'; from: number; to: number; node?: string }
  | { t: 'sync-resp'; blocks: Block[] }
  | { t: 'want-head' }
  | { t: 'head'; slot: number; hash: string; node?: string }

export interface GossipHandlers {
  onBlock(block: Block, from: string): void
  onWork(item: WorkItem, from: string): void
  onSyncReq(from: number, to: number, fromPeer: string): void
  onSyncResp(blocks: Block[]): void
  onHead(slot: number, hash: string, from: string): void
  onPeer(node: string, slot: number): void
}

const MSG_PERIOD = 1_000

export class Gossip {
  private wss?: WebSocketServer
  private peerSockets = new Map<WebSocket, { outgoing: boolean; node?: string }>()
  private lastSent = new Map<string, number>()
  private closeSocket?: () => void

  constructor(
    private readonly opts: { port: number; host: string; network: string; node: string; slot: () => number; handlers: GossipHandlers },
    private readonly log: Logger,
  ) {}

  /** Arranca el listener P2P */
  start(): void {
    this.wss = new WebSocketServer({ port: this.opts.port, host: this.opts.host })
    this.wss.on('connection', (socket) => {
      this.register(socket, false)
      socket.send(JSON.stringify(this.hello()))
    })
    this.wss.on('error', (e) => this.log.warn(`p2p server error: ${e.message}`))
    this.log.info(`p2p escuchando en ws://${this.opts.host}:${this.opts.port}`)
  }

  private hello(): NetMessage {
    return { t: 'hello', network: this.opts.network, node: this.opts.node, slot: this.opts.slot() }
  }

  private register(socket: WebSocket, outgoing: boolean): void {
    this.peerSockets.set(socket, { outgoing })
    socket.on('message', (data) => {
      try {
        this.route(JSON.parse(String(data)) as NetMessage, socket)
      } catch {
        socket.close()
      }
    })
    socket.on('close', () => this.peerSockets.delete(socket))
    socket.on('error', () => this.peerSockets.delete(socket))
    this.send(socket, this.hello())
  }

  /** Conecta a peers semilla */
  connectSeeds(seeds: string[]): void {
    for (const seed of seeds) {
      if (!seed.startsWith('ws://') && !seed.startsWith('wss://')) {
        this.log.warn(`seed invalida (se espera ws://host:puerto): ${seed}`)
        continue
      }
      const attempt = () => {
        const ws = new WebSocket(seed)
        const onOpen = () => {
          this.log.info(`conectado al seed ${seed}`)
          this.register(ws, true)
        }
        ws.once('open', onOpen)
        ws.on('error', (err) => {
          this.log.warn(`seed ${seed} no disponible: ${(err as Error).message}; reintentando...`)
          ws.off('open', onOpen)
          setTimeout(attempt, 5_000)
        })
      }
      attempt()
    }
  }

  private route(msg: NetMessage, from: WebSocket): void {
    if (msg.t === 'hello') {
      const peer = this.peerSockets.get(from)
      if (peer) peer.node = msg.node
      if (msg.network !== this.opts.network) from.close()
      this.opts.handlers.onPeer(msg.node, msg.slot)
      return
    }
    if (msg.t === 'block') {
      this.opts.handlers.onBlock(msg.block, msg.node ?? '?')
      return
    }
    if (msg.t === 'work') {
      this.opts.handlers.onWork(msg.item, msg.node ?? '?')
      return
    }
    if (msg.t === 'sync-req') {
      this.opts.handlers.onSyncReq(msg.from, msg.to, msg.node ?? '?')
      return
    }
    if (msg.t === 'sync-resp') {
      this.opts.handlers.onSyncResp(msg.blocks)
      return
    }
    if (msg.t === 'head') {
      this.opts.handlers.onHead(msg.slot, msg.hash, msg.node ?? '?')
      return
    }
    if (msg.t === 'want-head') {
      const h = this.opts.slot()
      // responder con nuestra cabeza
      return
    }
  }

  /** Envia un mensaje a todos (con dedup basado en hash para bloques/work) */
  broadcast(msg: NetMessage, dedupKey = ''): void {
    if (dedupKey) {
      const now = Date.now()
      const last = this.lastSent.get(dedupKey) ?? 0
      if (now - last < MSG_PERIOD) return
      this.lastSent.set(dedupKey, now)
    }
    const text = JSON.stringify(msg)
    for (const peer of [...this.peerSockets.keys()]) this.send(peer, msg, text)
  }

  private send(socket: WebSocket, msg: NetMessage, pre?: string): void {
    if (socket.readyState !== WebSocket.OPEN) return
    socket.send(pre ?? JSON.stringify(msg))
  }

  getPeerCount(): number {
    return this.peerSockets.size
  }

  getPeers(): Array<{ node?: string; outgoing: boolean }> {
    return [...this.peerSockets.values()]
  }

  closed(): void {
    this.closeSocket?.()
  }
}