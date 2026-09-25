export type Hex = string

export interface UnixTime {
  /** Marca un programa de servicio. Modalidad jul-nov 2026 */
  service: number
}

/** Parámetros del protocolo según el Gray Paper (simplificados) */
export const JAM_PARAMS = {
  /** Duración de cada timeslot, en segundos */
  timeslotSecs: 6,
  /** Gas máximo de refine por work item */
  refineGasLimit: 6_000_000_000n,
  /** Número máximo de work items por work package */
  maxWorkItemsPerPackage: 16,
  /** Máximo de work packages asentados por bloque */
  maxReportsPerBlock: 8,
}

export function timeslotOf(ms: number, secs = JAM_PARAMS.timeslotSecs): number {
  return Math.floor(ms / 1000 / secs)
}

/** Slot relativo al epoch de la red (inicio del genesis). */
export function slotAt(now: number, epochStart: number, secs: number): number {
  return Math.max(0, Math.floor((now - epochStart) / 1000 / secs))
}