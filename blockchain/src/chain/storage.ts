import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Block } from './block.js'
import { State } from './state.js'
import type { State as StateType } from './state.js'

export interface Snapshot {
  atSlot: number
  stateRoot: string
  blockHash: string
}

/** Almacenamiento de bloques (JSONL) + snapshots de estado, sin dependencias nativas. */
export class ChainStore {
  private blocks: Block[] = []
  private byHash = new Map<string, Block>()
  private bySlot = new Map<number, Block>()
  private filePath: string

  constructor(
    private readonly dir: string,
    public snapshotEvery = 48,
  ) {
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'blocks.jsonl')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    const raw = readFileSync(this.filePath, 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const block = JSON.parse(line) as Block
        this.blocks.push(block)
        this.byHash.set(block.hash, block)
        this.bySlot.set(block.header.timeslot, block)
      } catch {
        // linea corrupta: ignora
      }
    }
  }

  append(block: Block): void {
    appendFileSync(this.filePath, JSON.stringify(block) + '\n')
    this.blocks.push(block)
    this.byHash.set(block.hash, block)
    this.bySlot.set(block.header.timeslot, block)
  }

  getBySlot(slot: number): Block | undefined {
    return this.bySlot.get(slot)
  }

  getByHash(hash: string): Block | undefined {
    return this.byHash.get(hash)
  }

  latest(): Block | undefined {
    return this.blocks.at(-1)
  }

  /** Si hay huecos (sync), los rellena al mantener orden */
  insertInOrder(block: Block): void {
    if (this.byHash.has(block.hash)) return
    this.blocks.push(block)
    this.blocks.sort((a, b) => a.header.timeslot - b.header.timeslot)
    const idx = this.blocks.findIndex((b) => b.hash === block.hash)
    if (idx !== -1) this.blocks.splice(idx, 1)
    this.blocks.push(block)
    this.blocks.sort((a, b) => a.header.timeslot - b.header.timeslot)
    this.byHash.set(block.hash, block)
    this.bySlot.set(block.header.timeslot, block)
  }

  all(): Block[] {
    return [...this.blocks]
  }

  saveState(state: StateType, atSlot: number, blockHash: string): void {
    const snap: Snapshot = { atSlot, stateRoot: state.root(), blockHash }
    writeFileSync(join(this.dir, 'snapshot.json'), JSON.stringify(snap))
    writeFileSync(join(this.dir, 'state.json'), JSON.stringify(state.toJSON()))
  }

  loadSnapshot(): { state: State; snap: Snapshot } | undefined {
    const p = join(this.dir, 'snapshot.json')
    if (!existsSync(p)) return undefined
    const snap = JSON.parse(readFileSync(p, 'utf8')) as Snapshot
    const stateJson = JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8')) as Record<string, string>
    return { state: new State(stateJson), snap }
  }
}