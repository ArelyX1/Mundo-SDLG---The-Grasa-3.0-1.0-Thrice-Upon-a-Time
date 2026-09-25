import type { Logger } from './core/log.js'
import type { NodeConfig } from './config.js'
import type { GenesisConfig } from './genesis.js'
import { buildGenesisState } from './genesis.js'
import { ChainStore } from './chain/storage.js'
import type { Block } from './chain/block.js'
import { hashBody, hashBlock, ZERO_HASH } from './chain/block.js'
import { State } from './chain/state.js'
import { Pipeline } from './jam/pipeline.js'
import type { WorkItem } from './jam/work-package.js'
import { verifyItemSignature } from './jam/work-package.js'
import { AuthoritySet } from './consensus/authority.js'
import { Gossip } from './networking/gossip.js'
import { networkEpochStart } from './genesis.js'
import { slotAt } from './core/types.js'
import { signString, addressFromPublicKey, isValidAddress, fromSecretHex } from './core/crypto.js'
import { nonceKey, balanceOf, supplyOf, configOf, evmNonceOf, faucetClaimed, welcomeClaimed } from './services/papucoin/service.js'
import { ns } from './chain/state.js'
import { isEvmAddress } from './evm/evm.js'
import { PAPUCOIN } from './services/papucoin/service.js'

export interface EconomyEvent {
  slot: number
  itemId: string
  method: string
  from: string
  to: string | null
  amount: string | null
  fee: string | null
  ok: boolean
  memo: string
}

const EVENT_WINDOW = 256
const MAX_ITEMS_PER_BLOCK = 16

export class JamNode {
  readonly genesis: GenesisConfig
  readonly cfg: NodeConfig
  readonly authority: AuthoritySet
  readonly store: ChainStore
  readonly log: Logger
  private gossip?: Gossip
  state: State
  head!: Block
  private mempool = new Map<string, WorkItem>()
  private events = new Map<number, EconomyEvent[]>()
  private started = false
  private secretHex?: string
  private myAddress?: string
  private lastProducedSlot = -1
  private timer?: NodeJS.Timeout

  private epochStart = Date.now()

  constructor(cfg: NodeConfig, genesis: GenesisConfig, log: Logger) {
    this.cfg = cfg
    this.genesis = genesis
    this.log = log
    this.authority = new AuthoritySet(genesis.validators)
    this.store = new ChainStore(cfg.dataDir, 48)
    this.state = new State()
    this.epochStart = networkEpochStart(genesis)
  }

  /** Carga estado desde genesis reconstruyendo SOLO la cadena canonica; arranca el ruedo. */
  async boot(opts: { secretHex?: string; p2pSeeds?: string[] } = {}): Promise<void> {
    this.secretHex = opts.secretHex
    if (this.secretHex) this.myAddress = addressFromPublicKey(fromSecretHex(this.secretHex).publicKey)

    const genesisBlock = this.buildGenesisBlock()
    if (!this.store.getByHash(genesisBlock.hash)) this.store.append(genesisBlock)
    this.head = this.store.latest() ?? genesisBlock
    this.state = this.stateAtSigned(this.head) ?? buildGenesisState(this.genesis)

    const seeds = opts.p2pSeeds && opts.p2pSeeds.length ? opts.p2pSeeds : this.genesis.seedPeers
    this.gossip = new Gossip(
      {
        port: this.cfg.p2pPort,
        host: this.cfg.listenAll ? '0.0.0.0' : '127.0.0.1',
        network: this.cfg.network,
        node: this.cfg.nodeName,
        slot: () => this.head.header.timeslot,
        handlers: {
          onBlock: (b, from) => this.onIncomingBlock(b, from),
          onWork: (item, from) => this.onIncomingWork(item, from),
          onSyncReq: (from, to) => this.gossip?.broadcast({ t: 'sync-resp', blocks: this.blocksBetween(from, to) }, `sync${from}-${to}`),
          onSyncResp: (blocks) => this.onBlocks(blocks),
          onHead: (slot, _hash) => {
            this.maxPeerSlot = Math.max(this.maxPeerSlot, slot)
            if (slot > this.head.header.timeslot + 2) this.requestResync()
          },
          onPeer: (node, slot) => {
            this.maxPeerSlot = Math.max(this.maxPeerSlot, slot)
            if (slot > this.head.header.timeslot + 2) this.requestResync()
          },
        },
      },
      this.log,
    )
    this.gossip.start()
    this.gossip.connectSeeds(seeds)

    this.started = true
    this.log.info(
      `nodo "${this.cfg.nodeName}" head=slot ${this.head.header.timeslot} stateRoot=${this.state.root()} validadores=${this.genesis.validators.length}`,
    )
    if (!this.secretHex) this.log.warn('sin clave de validador: este nodo NO autorara bloques')
    this.timer = setInterval(() => this.tick(), 500)
  }

  private buildGenesisBlock(): Block {
    const header = {
      network: this.cfg.network,
      timeslot: 0,
      parentHash: ZERO_HASH,
      stateRoot: buildGenesisState(this.genesis).root(),
      bodyHash: hashBody({ reports: [] }),
      author: this.authority.leaderAddress(0),
      core: 0,
    }
    return { header, body: { reports: [] }, signature: '', hash: hashBlock(header, '') }
  }

  private tick(): void {
    if (!this.started) return
    const slot = slotAt(Date.now(), this.epochStart, this.genesis.timeslotSecs)
    const headSlot = this.head.header.timeslot
    if (slot > headSlot && this.shouldProduce(slot)) this.produce(slot)
    if (headSlot < slot - 1) this.requestResync()
    if (headSlot === slot) this.gossip?.broadcast({ t: 'head', slot, hash: this.head.hash }, `head${slot}`)
  }

  private shouldProduce(slot: number): boolean {
    if (!this.secretHex) return false
    // No autorar si vamos atrasados Y algun peer declara un head mayor:
    // evita crear forks desde un tip desactualizado sin congelar la red.
    const head = this.head.header.timeslot
    const behind = head < slot - 1
    const peerAhead = this.maxPeerSlot > head
    if (behind && peerAhead) {
      this.log.warn(`posponemos autorar (slot ${slot}): head=${head}, solicitamos resync`)
      this.requestResync()
      return false
    }
    const myPub = fromSecretHex(this.secretHex).publicKey
    return this.authority.isLeader(myPub, slot) && slot > this.lastProducedSlot
  }

  /** Autor de bloque: refine -> accumulate -> firmar -> difundir */
  private produce(slot: number): void {
    const leaderPub = this.authority.leaderPublicKey(slot)
    const myPub = fromSecretHex(this.secretHex!).publicKey
    if (myPub !== leaderPub) {
      this.log.warn(`no somos lider del slot ${slot} (se espera ${leaderPub.slice(0, 8)})`)
      return
    }
    const items = this.pickItems()
    const report = this.pipelineRefine(items, slot)
    const clone = this.state.clone()
    new Pipeline(clone).accumulate([report], slot)
    const header = {
      network: this.cfg.network,
      timeslot: slot,
      parentHash: this.head.hash,
      stateRoot: clone.root(),
      bodyHash: hashBody({ reports: [report] }),
      author: this.myAddress!,
      core: 0,
    }
    const signature = signString(JSON.stringify({ h: header }), this.secretHex!)
    const block: Block = { header, body: { reports: [report] }, signature, hash: hashBlock(header, signature) }

    this.log.info(
      `bloque #${slot} autor=${this.cfg.nodeName} items=${items.length} ok=${report.results.filter((r) => r.ok).length} state=${header.stateRoot.slice(0, 16)}...`,
    )
    this.commit(block, clone)
    this.lastProducedSlot = slot
    this.gossip?.broadcast({ t: 'block', block }, block.hash)
  }

  private pipelineRefine(items: WorkItem[], slot: number) {
    return new Pipeline(this.state).refine(items, { slot, author: this.myAddress ?? '', maxItems: MAX_ITEMS_PER_BLOCK })
  }

  private onIncomingBlock(block: Block, from: string): void {
    this.log.debug(`bloque de ${from}: slot ${block.header.timeslot}`)
    this.maxPeerSlot = Math.max(this.maxPeerSlot, block.header.timeslot)
    if (block.header.timeslot <= this.head.header.timeslot) return
    if (block.header.network !== this.cfg.network) return
    if (block.header.parentHash !== this.head.hash) {
      // Cadena divergente: intenta adoptar la rama mas larga (reorg por replay).
      this.log.warn(`bloque #${block.header.timeslot}: parent ${block.header.parentHash.slice(0, 12)} != head, intentando reorg...`)
      this.tryAdopt(block)
      return
    }
    if (!this.authority.verifyBlockSignature(block)) {
      this.log.error(`bloque #${block.header.timeslot} FIRMA/AUTOR INVALIDO`)
      return
    }
    const clone = this.state.clone()
    this.applyPipeline(clone, block.body.reports, block.header.timeslot)
    if (clone.root() !== block.header.stateRoot) {
      this.log.error(`bloque #${block.header.timeslot} DISPUTA: raiz de estado no coincide (${clone.root().slice(0, 12)} vs ${block.header.stateRoot.slice(0, 12)})`)
      return
    }
    this.commit(block, clone)
    this.gossip?.broadcast({ t: 'block', block }, block.hash)
  }

  /** Adopta la cadena mas larga recibida: reconstruye el estado en el ancestro comun. */
  private tryAdopt(block: Block): void {
    const canonical = new Set<string>()
    for (let c: Block | undefined = this.head; c; c = c.header.parentHash === ZERO_HASH ? undefined : this.store.getByHash(c.header.parentHash)) canonical.add(c.hash)

    const newChain: Block[] = []
    let cur: Block | undefined = block
    const seen = new Set<string>()
    while (cur && !canonical.has(cur.hash) && !seen.has(cur.hash)) {
      seen.add(cur.hash)
      newChain.unshift(cur)
      if (cur.header.parentHash === ZERO_HASH || cur.header.parentHash === this.genesisBlockHash()) {
        cur = undefined
      } else {
        const parent = this.store.getByHash(cur.header.parentHash)
        if (!parent) {
          this.log.warn(`reorg: falta ancestro de #${cur.header.timeslot - 1}, resync descendente`)
          this.descendSync(Math.max(cur.header.timeslot, this.head.header.timeslot))
          return
        }
        cur = parent
      }
    }
    const lca = cur
    if (!lca || newChain.length === 0) return
    if (lca.header.timeslot >= block.header.timeslot) return

    for (const b of newChain) {
      if (!this.authority.verifyBlockSignature(b)) {
        this.log.error(`reorg: bloque #${b.header.timeslot} FIRMA INVALIDA, abortamos`)
        return
      }
    }

    const base = this.stateAtSigned(lca)
    if (!base) return
    let s: State | undefined = base
    const adopted: Array<{ block: Block; state: State }> = []
    for (const b of newChain) {
      const clone: State = s!.clone()
      this.applyPipeline(clone, b.body.reports, b.header.timeslot)
      if (clone.root() !== b.header.stateRoot) {
        this.log.error(`reorg: DISPUTA en #${b.header.timeslot} (raiz ${b.header.stateRoot.slice(0, 12)})`)
        return
      }
      s = clone
      adopted.push({ block: b, state: clone })
    }
    this.log.warn(`reorg: adoptamos cadena mas larga a slot #${block.header.timeslot} (${adopted.length} bloques)`)
    for (const { block: b, state } of adopted) {
      this.commit(b, state)
    }
    this.adoptLo = 0
  }

  private genesisBlockHash(): string {
    return this.buildGenesisBlock().hash
  }

  /** Estado exacto de un bloque de la cadena canonica, reconstruido desde genesis. */
  private stateAtSigned(target: Block): State | undefined {
    const path: Block[] = []
    let cur: Block | undefined = target
    const seen = new Set<string>()
    while (cur && !seen.has(cur.hash)) {
      seen.add(cur.hash)
      path.unshift(cur)
      if (cur.header.parentHash === ZERO_HASH || cur.header.parentHash === this.genesisBlockHash()) {
        cur = undefined
      } else {
        const parent = this.store.getByHash(cur.header.parentHash)
        if (!parent) return undefined
        cur = parent
      }
    }
    const state = buildGenesisState(this.genesis)
    for (const b of path) this.applyPipeline(state, b.body.reports, b.header.timeslot)
    return state
  }

  private applyPipeline(state: State, reports: Block['body']['reports'], slot: number): void {
    new Pipeline(state).accumulate(reports, slot)
  }

  private onIncomingWork(item: WorkItem, from: string): void {
    this.log.debug(`work de ${from}: ${item.method} ${item.id.slice(0, 12)}`)
    this.submitWorkItem(item, false)
  }

  private onBlocks(blocks: Block[]): void {
    if (!blocks.length) return
    const sorted = [...blocks].sort((a, b) => a.header.timeslot - b.header.timeslot)
    this.log.debug(`sync-resp: [${sorted.map((b) => b.header.timeslot).join(',')}]`)
    if (sorted[0]!.header.parentHash === this.head.hash) {
      for (const b of sorted) this.onIncomingBlock(b, this.cfg.nodeName)
      return
    }
    this.adoptChain(sorted)
  }

  /** Adopta una cadena completa (p.ej. respuesta de sync), aun si cruza slots <= head (fork). */
  private adoptChain(sorted: Block[]): void {
    const newChain = sorted.filter((b) => !this.store.getByHash(b.hash))
    if (!newChain.length) return
    const first = newChain[0]!
    const last = newChain[newChain.length - 1]!
    const lca = this.findAncestorInCanonical(first)
    if (!lca) {
      this.log.warn(`adoptChain: falta ancestro de #${first.header.timeslot}, resync descendente`)
      this.descendSync(last.header.timeslot)
      return
    }
    if (lca.header.timeslot >= last.header.timeslot) return
    for (let i = 1; i < newChain.length; i++) {
      if (newChain[i]!.header.parentHash !== newChain[i - 1]!.hash) {
        this.log.warn('adoptChain: sync con huecos internos, ignoramos rango')
        return
      }
    }
    for (const b of newChain) {
      if (!this.authority.verifyBlockSignature(b)) {
        this.log.error(`adoptChain: bloque #${b.header.timeslot} FIRMA INVALIDA`)
        return
      }
    }
    const base = this.stateAtSigned(lca)
    if (!base) return
    let s: State | undefined = base
    const adopted: Array<{ block: Block; state: State }> = []
    for (const b of newChain) {
      const clone: State = s!.clone()
      this.applyPipeline(clone, b.body.reports, b.header.timeslot)
      if (clone.root() !== b.header.stateRoot) {
        this.log.error(`adoptChain: DISPUTA en #${b.header.timeslot}`)
        return
      }
      s = clone
      adopted.push({ block: b, state: clone })
    }
    this.log.warn(`reorg(sync): adoptamos ${adopted.length} bloques hasta #${last.header.timeslot}`)
    for (const { block: b, state } of adopted) this.commit(b, state)
    this.adoptLo = 0
  }

  private findAncestorInCanonical(first: Block): Block | undefined {
    const canonical = new Set<string>()
    for (let c: Block | undefined = this.head; c; c = c.header.parentHash === ZERO_HASH ? undefined : this.store.getByHash(c.header.parentHash)) canonical.add(c.hash)
    for (let c: Block | undefined = first; c; c = c.header.parentHash === ZERO_HASH ? undefined : this.store.getByHash(c.header.parentHash)) {
      if (canonical.has(c.hash)) return c
    }
    return undefined
  }

  private requestResync(): void {
    const anchor = Math.max(this.maxPeerSlot, this.head.header.timeslot)
    this.requestSyncRange(Math.max(1, anchor - 63), anchor)
  }

  private lastSyncReq = ''
  private adoptLo = 0
  private maxPeerSlot = 0

  private requestSyncRange(from: number, to: number): void {
    const key = `${Math.floor(from / 64)}-${Math.floor(to / 64)}`
    if (key === this.lastSyncReq) return
    this.lastSyncReq = key
    this.gossip?.broadcast({ t: 'sync-req', from, to })
  }

  /** Baja el rango de sync hasta cruzar el punto donde diverge nuestro fork. */
  private descendSync(currentSlot: number): void {
    this.adoptLo = this.adoptLo === 0 ? Math.max(1, currentSlot - 64) : Math.max(1, this.adoptLo - 64)
    this.requestSyncRange(this.adoptLo, currentSlot)
  }

  /** Sirve SOLO bloques de la cadena canonica (evita propagar forks). */
  private blocksBetween(from: number, to: number): Block[] {
    const out: Block[] = []
    for (let c: Block | undefined = this.head; c; c = c.header.parentHash === ZERO_HASH ? undefined : this.store.getByHash(c.header.parentHash)) {
      if (c.header.timeslot >= from && c.header.timeslot <= to) out.unshift(c)
    }
    return out.slice(0, 64)
  }

  private commit(block: Block, next: State): void {
    if (this.store.getByHash(block.hash)) return
    this.state = next
    this.head = block
    this.store.append(block)
    this.extractEvents(block)
    if (block.header.timeslot && block.header.timeslot % this.store.snapshotEvery === 0) {
      this.store.saveState(next, block.header.timeslot, block.hash)
    }
    this.pruneMempool(block)
  }

  private extractEvents(block: Block): void {
    const evts: EconomyEvent[] = []
    for (const report of block.body.reports) {
      for (let i = 0; i < report.items.length; i++) {
        const item = report.items[i]
        const res = report.results[i]
        if (!item || !res) continue
        const output = res.output as Record<string, unknown> | undefined
        evts.push({
          slot: block.header.timeslot,
          itemId: item.id,
          method: item.method,
          from: item.sender,
          to: (output?.to as string) ?? null,
          amount: (output?.amountRaw as string) ?? null,
          fee: (output?.feeRaw as string) ?? null,
          ok: res.ok,
          memo: item.memo ?? '',
        })
      }
    }
    if (evts.length) this.events.set(block.header.timeslot, evts)
    if (this.events.size > EVENT_WINDOW) {
      const oldest = [...this.events.keys()].sort((a, b) => a - b)[0]!
      this.events.delete(oldest)
    }
  }

  /** Valida y encola un work item (desde RPC/API local o de red) */
  submitWorkItem(item: WorkItem, broadcast = true): { accepted: boolean; reason?: string } {
    if (!verifyItemSignature(item)) return { accepted: false, reason: 'firma invalida' }
    if (this.mempool.has(item.id)) return { accepted: true }
    if (item.nonce < 1) return { accepted: false, reason: 'nonce invalido' }
    this.mempool.set(item.id, item)
    if (broadcast) this.gossip?.broadcast({ t: 'work', item }, item.id)
    return { accepted: true }
  }

  private pickItems(): WorkItem[] {
    return [...this.mempool.values()]
      .sort((a, b) => (a.sender === b.sender ? a.nonce - b.nonce : a.sender < b.sender ? -1 : 1))
      .slice(0, MAX_ITEMS_PER_BLOCK)
  }

  private pruneMempool(block: Block): void {
    for (const report of block.body.reports) for (const item of report.items) this.mempool.delete(item.id)
  }

  nonceOf(addr: string): bigint {
    if (!isValidAddress(addr)) return 0n
    return BigInt(this.state.get(nonceKey(addr)) ?? '1')
  }

  balanceOf(addr: string): bigint {
    return balanceOf(this.state, addr)
  }

  evmNonceOf(addr: string): bigint {
    return evmNonceOf(this.state, addr)
  }

  faucetClaimed(addr: string): boolean {
    return faucetClaimed(this.state, addr)
  }

  welcomeClaimed(addr: string): boolean {
    return welcomeClaimed(this.state, addr)
  }

  supply(): bigint {
    return supplyOf(this.state)
  }

  /** Enumera cuentas on-chain con saldo > 0 (wallets nativas sdlg y EVM 0x). */
  listAccounts(): Array<{ address: string; kind: 'sdlg' | 'evm'; balanceRaw: string }> {
    const prefix = ns('papucoin', ['balance', PAPUCOIN.symbol, ''])
    const out: Array<{ address: string; kind: 'sdlg' | 'evm'; balanceRaw: string }> = []
    for (const [k, v] of this.state.entries()) {
      if (!k.startsWith(prefix)) continue
      const raw = BigInt(v)
      if (raw <= 0n) continue
      const address = k.slice(prefix.length)
      out.push({ address, kind: isEvmAddress(address) ? 'evm' : 'sdlg', balanceRaw: raw.toString() })
    }
    return out.sort((a, b) => (a.address < b.address ? -1 : 1))
  }

  economyConfig() {
    return configOf(this.state)
  }

  eventsLatest(n = 20): EconomyEvent[] {
    const sorted = [...this.events.entries()].sort((a, b) => b[0] - a[0])
    const out: EconomyEvent[] = []
    for (const [, evts] of sorted) for (const e of evts) out.push(e)
    return out.slice(0, n)
  }

  mempoolSize(): number {
    return this.mempool.size
  }

  peerCount(): number {
    return this.gossip?.getPeerCount() ?? 0
  }

  gossipPeers(): Array<{ node?: string; outgoing: boolean }> {
    return this.gossip?.getPeers() ?? []
  }

  getP2PInfo() {
    return { node: this.cfg.nodeName, port: this.cfg.p2pPort, listenAll: this.cfg.listenAll }
  }

  shutdown(): void {
    this.started = false
    if (this.timer) clearInterval(this.timer)
    this.store.saveState(this.state, this.head.header.timeslot, this.head.hash)
    this.log.info('nodo detenido')
  }
}

export { PAPUCOIN }