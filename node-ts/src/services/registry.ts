import type { State } from '../chain/state.js'
import type { WorkItem } from '../jam/work-package.js'
export type { WorkOutput } from '../jam/work-package.js'
import type { WorkOutput } from '../jam/work-package.js'
import { papucoinService } from './papucoin/service.js'

export type RefineResult = { ok: true; output: WorkOutput } | { ok: false; error: string }

/**
 * Un servicio JAM: codigo con 3 puntos de entrada (Gray Paper).
 * - refine:      computacion "fuera de cadena", mayormente sin estado.
 * - accumulate:  dobla los resultados de refine() al estado compartido.
 * - on_transfer: acepta tokens/memo de otros servicios (acuerdos).
 */
export interface JamService {
  id: number
  name: string
  symbol?: string
  refine(item: WorkItem): RefineResult
  accumulate(outputs: Array<{ item: WorkItem; output: WorkOutput }>, state: State, slot: number): void
  onTransfer(transfer: Record<string, unknown>, state: State): void
  genesisSetup?(state: State, opts: { issuer: string; initialBalances: Record<string, string>; maxSupply?: string }): void
}

const BUILTIN: JamService[] = [papucoinService]

class Registry {
  private services = new Map<number, JamService>()

  constructor() {
    for (const s of BUILTIN) this.services.set(s.id, s)
    if (!this.services.has(0)) throw new Error('Falta el servicio PAPUCOIN (id 0)')
  }

  get(id: number): JamService | undefined {
    return this.services.get(id)
  }

  list(): JamService[] {
    return [...this.services.values()].sort((a, b) => a.id - b.id)
  }

  /** registrar servicios desplegados por terceros (futuro) */
  register(s: JamService): void {
    if (this.services.has(s.id)) throw new Error(`Servicio ${s.id} ya registrado`)
    this.services.set(s.id, s)
  }
}

export const registry = new Registry()