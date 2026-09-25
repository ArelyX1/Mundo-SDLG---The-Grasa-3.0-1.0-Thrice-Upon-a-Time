import { stateRoot } from '../core/merkle.js'

/** Estado de la cadena: mapa determinista clave->valor hex. */
export class State {
  private map = new Map<string, string>()

  constructor(initial?: Record<string, string>) {
    if (initial) for (const [k, v] of Object.entries(initial)) this.map.set(k, v)
  }

  get(key: string): string | undefined {
    return this.map.get(key)
  }

  set(key: string, value: string): void {
    this.map.set(key, value)
  }

  del(key: string): void {
    this.map.delete(key)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  entries(): Map<string, string> {
    return new Map(this.map)
  }

  root(): string {
    return stateRoot(this.map)
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.map)
  }

  clone(): State {
    const s = new State()
    for (const [k, v] of this.map) s.set(k, v)
    return s
  }

  /** Leer un valor JSON */
  getJSON<T = unknown>(key: string): T | undefined {
    const v = this.map.get(key)
    return v === undefined ? undefined : (JSON.parse(v) as T)
  }

  /** Escribir un valor JSON */
  setJSON(key: string, value: unknown): void {
    this.map.set(key, JSON.stringify(value))
  }
}

/** Construye clave de estado con prefijo de servicio para aislamiento */
export function ns(service: string, parts: (string | number)[]): string {
  return [service, ...parts].join('/')
}