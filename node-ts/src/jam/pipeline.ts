import type { State } from '../chain/state.js'
import { registry } from '../services/registry.js'
import { verifyItemSignature } from './work-package.js'
import type { WorkItem, WorkReport, WorkResult } from './work-package.js'

export interface PipelineOptions {
  slot: number
  author: string
  maxItems?: number
}

/**
 * Pipeline JAM:
 * 1) refine() por work item -> work results (fuera de cadena, determinista).
 * 2) el work report se incluye en el bloque.
 * 3) accumulate() por servicio dobla los outputs al estado compartido.
 * 4) on_transfer() para transferencias entre servicios (reservado).
 */
export class Pipeline {
  constructor(private readonly state: State) {}

  /** Refina un work package (autor), produciendo results */
  refine(items: WorkItem[], opts: PipelineOptions): WorkReport {
    const limit = opts.maxItems ?? items.length
    const taken = items.slice(0, limit)
    const results: WorkResult[] = []
    for (const item of taken) {
      if (!verifyItemSignature(item)) {
        results.push({ itemId: item.id, ok: false, error: 'firma invalida', gasUsed: 0 })
        continue
      }
      const service = registry.get(item.serviceId)
      const started = process.hrtime.bigint()
      if (!service) {
        results.push({ itemId: item.id, ok: false, error: `servicio desconocido: ${item.serviceId}`, gasUsed: 0 })
        continue
      }
      const r = service.refine(item)
      const gasUsed = Number((process.hrtime.bigint() - started) / 1_000_000n)
      if (r.ok) results.push({ itemId: item.id, ok: true, output: r.output, gasUsed })
      else results.push({ itemId: item.id, ok: false, error: r.error, gasUsed })
    }
    return {
      core: 0,
      author: opts.author,
      packageHash: items.length ? (taken[0]?.id ?? opts.slot.toString()) : `${opts.slot}:${opts.author}`,
      items: taken,
      results,
    }
  }

  /**
   * Aplica accumulate() de cada servicio sobre sus work results del bloque.
   * Mutacion determinista: todos los validadores deben llegar al mismo estado.
   */
  accumulate(reports: WorkReport[], slot: number): void {
    for (const report of reports) {
      const byService = new Map<number, Array<{ item: WorkItem; output: NonNullable<WorkResult['output']> }>>()
      for (let i = 0; i < report.items.length; i++) {
        const res = report.results[i]
        if (!res) continue
        if (!res.ok || !res.output) continue
        const list = byService.get(report.items[i]!.serviceId) ?? []
        list.push({ item: report.items[i]!, output: res.output })
        byService.set(report.items[i]!.serviceId, list)
      }
      for (const [serviceId, outputs] of byService) {
        const service = registry.get(serviceId)
        if (!service) continue
        service.accumulate(outputs, this.state, slot)
      }
    }
  }

  /** Sincroniza CROSS-SERVICE: reparte transferencias salientes a on_transfer de cada servicio. (acuerdos) */
  onTransfer(_state: State): void {
    for (const s of registry.list()) s.onTransfer({}, this.state)
  }
}