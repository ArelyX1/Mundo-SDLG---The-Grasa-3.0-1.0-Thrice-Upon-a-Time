const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const RADIX = BigInt(58)

export function u8toBigInt(u8: Uint8Array): bigint {
  let n = 0n
  for (const b of u8) n = (n << 8n) | BigInt(b)
  return n
}

export function bigIntToU8(n: bigint, minLen = 0): Uint8Array {
  const bytes: number[] = []
  let v = n
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn))
    v >>= 8n
  }
  while (bytes.length < minLen) bytes.unshift(0)
  return new Uint8Array(bytes)
}

export function base58Encode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let n = u8toBigInt(bytes)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % RADIX)] + out
    n /= RADIX
  }
  for (const b of bytes) {
    if (b !== 0) break
    out = ALPHABET[0] + out
  }
  return out
}

export function base58Decode(str: string): Uint8Array {
  let n = 0n
  for (const c of str) {
    const idx = ALPHABET.indexOf(c)
    if (idx === -1) throw new Error(`Caracter base58 invalido: ${c}`)
    n = n * RADIX + BigInt(idx)
  }
  let bytes = bigIntToU8(n)
  for (const c of str) {
    if (c !== ALPHABET[0]) break
    bytes = new Uint8Array([0, ...bytes])
  }
  return bytes
}