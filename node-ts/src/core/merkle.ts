import { blakeHex } from './crypto.js'

/**
 * Árbol de Merkle estático y determinista sobre un mapa de estado clave->valor hex.
 * Los pares se ordenan por clave y las hojas se hashean como H(clave || valor).
 * La raíz es un vector de compromiso (a lo JAM: estado = raíz de Merkle).
 */
export function stateRoot(leaves: Map<string, string>): string {
  if (leaves.size === 0) return blakeHex('EMPTY_STATE')
  const hashes = [...leaves.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => blakeHex(k + ':' + v))
  let level = hashes
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!
      const right = i + 1 < level.length ? level[i + 1]! : left
      next.push(blakeHex(left + right))
    }
    level = next
  }
  return level[0]!
}

export function hashBlockBody(body: unknown): string {
  return blakeHex(JSON.stringify(body))
}