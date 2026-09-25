import type { State } from '../../chain/state.js'
import { ns } from '../../chain/state.js'
import { verifyItemSignature, itemSignPayload, computeItemId } from '../../jam/work-package.js'
import type { WorkItem } from '../../jam/work-package.js'
import { isValidAddress } from '../../core/crypto.js'
import { signString } from '../../core/crypto.js'
import { isEvmAddress, normalizeEvmAddress, parseEvmTx, weiToRaw } from '../../evm/evm.js'
import type { JamService, WorkOutput } from '../registry.js'

export const PAPUCOIN = {
  serviceId: 0,
  name: 'CRYPTOPAPU',
  symbol: 'PAPU',
  decimals: 12,
  /** Max supply: 1.000.000.000 PAPU (10^9 unidades * 10^12 unidades atomicas) */
  maxSupply: BigInt(1_000_000_000) * 10n ** 12n,
  /** Fee de transferencia por item: 1 micro-PAPU (1e-6) */
  transferFee: BigInt(1_000_000),
  faucetAmount: BigInt(10_000) * 10n ** 12n,
  /** Bienvenida por wallet nueva (conectar red por primera vez): 5 PAPU, una sola vez. */
  welcomeAmount: BigInt(5) * 10n ** 12n,
} as const

const CONFIG = 'config'
const FAUCET_CLAIM = 'faucet'
const WELCOME_CLAIM = 'welcome'

export function balanceKey(assetId: string, addr: string): string {
  const a = isEvmAddress(addr) ? normalizeEvmAddress(addr) : addr
  return ns('papucoin', ['balance', assetId, a])
}
export function nonceKey(addr: string): string {
  return ns('papucoin', ['nonce', addr])
}
export function supplyKey(assetId: string): string {
  return ns('papucoin', ['supply', assetId])
}
export function evmNonceKey(addr: string): string {
  return ns('papucoin', ['evmnonce', normalizeEvmAddress(addr)])
}
/** Nonce EVM (0x) de una cuenta: arranca en 0 (como Ethereum), distinto del nonce de items JAM. */
export function evmNonceOf(state: State, addr: string): bigint {
  if (!isEvmAddress(addr)) return 0n
  return BigInt(state.get(evmNonceKey(addr)) ?? '0')
}

/** True si la direccion (sdlg o 0x) ya reclamó el faucet. */
export function faucetClaimed(state: State, addr: string): boolean {
  const a = isEvmAddress(addr) ? normalizeEvmAddress(addr) : isValidAddress(addr) ? addr : ''
  return a ? state.has(faucetKey(a)) : false
}
function configKey(): string {
  return ns('papucoin', [CONFIG])
}
function faucetKey(addr: string): string {
  return ns('papucoin', [FAUCET_CLAIM, addr])
}
export function welcomeKey(addr: string): string {
  return ns('papucoin', [WELCOME_CLAIM, addr])
}

/** True si la direccion (sdlg o 0x) ya recibio el regalo de bienvenida (una sola vez). */
export function welcomeClaimed(state: State, addr: string): boolean {
  const a = isEvmAddress(addr) ? normalizeEvmAddress(addr) : isValidAddress(addr) ? addr : ''
  return a ? state.has(welcomeKey(a)) : false
}

export interface PapucoinConfig {
  symbol: string
  name: string
  decimals: number
  maxSupplyRaw: string
  issuer: string
}

/** Normaliza una direccion destino: acepta sdlg1... y 0x... (EVM en minuscula para storage). */
function normalizeAddress(input: string): string | null {
  const v = String(input ?? '').trim()
  if (isEvmAddress(v)) return normalizeEvmAddress(v)
  return isValidAddress(v) ? v : null
}

/** Formatea un numero crudo (BigInt) a string con decimales */
export function formatRaw(raw: bigint, decimals = PAPUCOIN.decimals): string {
  const neg = raw < 0n
  const abs = neg ? -raw : raw
  const s = abs.toString().padStart(decimals + 1, '0')
  const i = s.slice(0, -decimals)
  const d = s.slice(-decimals).replace(/0+$/, '')
  return (neg ? '-' : '') + (i || '0') + (d ? '.' + d : '')
}

/** Parsea "123.000001" a BigInt crudo */
export function parseAmount(input: string | number, decimals = PAPUCOIN.decimals): bigint {
  const s = typeof input === 'number' ? String(input) : input.trim()
  if (s.startsWith('+')) throw new Error(`Monto invalido: ${input}`)
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Monto invalido: ${input}`)
  const [i = '', d = ''] = s.split('.')
  if (d.length > decimals) throw new Error(`Monto con demasiados decimales: ${input}`)
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((d + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

/** Convierte crudo (BigInt) al formato legible en PAPU (devuelve string con decimales) */
export function rawToDisplay(raw: string | bigint): string {
  return formatRaw(BigInt(raw))
}

export const papucoinService: JamService = {
  id: PAPUCOIN.serviceId,
  name: PAPUCOIN.name,
  symbol: PAPUCOIN.symbol,

  refine(item: WorkItem): { ok: true; output: WorkOutput } | { ok: false; error: string } {
    if (item.serviceId !== PAPUCOIN.serviceId) return { ok: false, error: 'servicio distinto' }
    if (!verifyItemSignature(item)) return { ok: false, error: 'firma invalida' }

    try {
      switch (item.method) {
        case 'transfer': {
          const to = normalizeAddress(String(item.params.to ?? ''))
          if (!to) return { ok: false, error: 'direccion destino invalida' }
          const relayedFrom = String(item.params.from ?? '')
          let from = item.sender
          let amountRaw: bigint
          let evmNonce: number | undefined
          if (relayedFrom) {
            // Transfer EVM relayado: una tx Ethereum firmada con ECDSA (secp256k1) sobre la que
            // el relay (wallet del nodo) autoritativamente construye el work item.
            if (!isEvmAddress(relayedFrom) || !isEvmAddress(to)) return { ok: false, error: 'transfer EVM requiere origen y destino 0x' }
            const raw = String(item.params.raw ?? '')
            let parsed: ReturnType<typeof parseEvmTx>
            try {
              parsed = parseEvmTx(raw)
            } catch {
              return { ok: false, error: 'firma EVM invalida' }
            }
            if (normalizeEvmAddress(parsed.from) !== normalizeEvmAddress(relayedFrom)) return { ok: false, error: 'origen no coincide con la firma' }
            if (normalizeEvmAddress(parsed.to) !== to) return { ok: false, error: 'destino no coincide con la firma' }
            if (parsed.data) return { ok: false, error: 'data/contratos no soportado' }
            try {
              amountRaw = weiToRaw(parsed.value)
            } catch {
              return { ok: false, error: 'valor no divisible en 1e6 (granularidad de 1 micro)' }
            }
            if (amountRaw <= 0n) return { ok: false, error: 'monto debe ser mayor a 0' }
            evmNonce = Number(parsed.nonce)
            from = normalizeEvmAddress(relayedFrom)
          } else {
            const x = parseAmount(String(item.params.amount ?? ''))
            if (x <= 0n) return { ok: false, error: 'monto debe ser mayor a 0' }
            amountRaw = x
          }
          return {
            ok: true,
            output: {
              op: 'transfer',
              from,
              to,
              amountRaw: amountRaw.toString(),
              feeRaw: PAPUCOIN.transferFee.toString(),
              memo: item.memo ?? '',
              ...(evmNonce !== undefined ? { evmNonce, hash: String(item.params.raw ?? '').slice(0, 18) } : {}),
            },
          }
        }
        case 'mint': {
          const to = normalizeAddress(String(item.params.to ?? ''))
          if (!to) return { ok: false, error: 'direccion destino invalida' }
          const amountRaw = parseAmount(String(item.params.amount))
          if (amountRaw <= 0n) return { ok: false, error: 'monto debe ser mayor a 0' }
          return { ok: true, output: { op: 'mint', to, amountRaw: amountRaw.toString() } }
        }
        case 'burn': {
          const amountRaw = parseAmount(String(item.params.amount))
          if (amountRaw <= 0n) return { ok: false, error: 'monto debe ser mayor a 0' }
          return { ok: true, output: { op: 'burn', from: item.sender, amountRaw: amountRaw.toString() } }
        }
        case 'faucet': {
          const toInput = String(item.params.to ?? '')
          const to = toInput ? normalizeAddress(toInput) : item.sender
          if (!to) return { ok: false, error: 'direccion invalida' }
          return { ok: true, output: { op: 'faucet', from: item.sender, to } }
        }
        case 'welcome': {
          const toInput = String(item.params.to ?? '')
          const to = toInput ? normalizeAddress(toInput) : item.sender
          if (!to) return { ok: false, error: 'direccion invalida' }
          return { ok: true, output: { op: 'welcome', from: item.sender, to } }
        }
        default:
          return { ok: false, error: `metodo desconocido: ${item.method}` }
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  accumulate(outputs: Array<{ item: WorkItem; output: WorkOutput }>, state: State): void {
    const cfg = state.getJSON<PapucoinConfig>(configKey())
    if (!cfg) throw new Error('PAPUCOIN: config no registrada en genesis')
    const assetId = cfg.symbol

    for (const { item, output } of outputs) {
      const sender = item.sender
      const nonce = item.nonce
      const expectedNonce = BigInt(state.get(nonceKey(sender)) ?? '1')

      if (BigInt(nonce) !== expectedNonce) continue

      switch (output.op) {
        case 'transfer': {
          const from = (output.from as string) ?? sender
          const to = output.to as string
          const amountRaw = BigInt(output.amountRaw as string)
          const feeRaw = BigInt(output.feeRaw as string)
          if (output.evmNonce !== undefined && BigInt(output.evmNonce as number) !== evmNonceOf(state, from)) continue
          const balFrom = BigInt(state.get(balanceKey(assetId, from)) ?? '0')
          if (balFrom < amountRaw + feeRaw) continue
          state.set(balanceKey(assetId, from), (balFrom - amountRaw - feeRaw).toString())
          state.set(balanceKey(assetId, to), (BigInt(state.get(balanceKey(assetId, to)) ?? '0') + amountRaw).toString())
          if (feeRaw > 0n) {
            const supply = BigInt(state.get(supplyKey(assetId)) ?? cfg.maxSupplyRaw)
            const next = supply > feeRaw ? supply - feeRaw : 0n
            state.set(supplyKey(assetId), next.toString())
          }
          if (output.evmNonce !== undefined) state.set(evmNonceKey(from), String(BigInt(output.evmNonce as number) + 1n))
          state.set(nonceKey(item.sender), (expectedNonce + 1n).toString())
          break
        }
        case 'mint': {
          if (sender !== cfg.issuer) continue
          const to = output.to as string
          const amountRaw = BigInt(output.amountRaw as string)
          const supply = BigInt(state.get(supplyKey(assetId)) ?? cfg.maxSupplyRaw)
          const maxSupply = BigInt(cfg.maxSupplyRaw)
          if (supply + amountRaw > maxSupply) continue
          state.set(supplyKey(assetId), (supply + amountRaw).toString())
          state.set(balanceKey(assetId, to), (BigInt(state.get(balanceKey(assetId, to)) ?? '0') + amountRaw).toString())
          state.set(nonceKey(sender), (expectedNonce + 1n).toString())
          break
        }
        case 'burn': {
          const amountRaw = BigInt(output.amountRaw as string)
          const bal = BigInt(state.get(balanceKey(assetId, sender)) ?? '0')
          if (bal < amountRaw) continue
          state.set(balanceKey(assetId, sender), (bal - amountRaw).toString())
          const supply = BigInt(state.get(supplyKey(assetId)) ?? cfg.maxSupplyRaw)
          state.set(supplyKey(assetId), supply > amountRaw ? (supply - amountRaw).toString() : '0')
          state.set(nonceKey(sender), (expectedNonce + 1n).toString())
          break
        }
        case 'faucet': {
          const target = (output.to as string) ?? item.sender
          if (state.has(faucetKey(target))) continue
          const amountRaw = PAPUCOIN.faucetAmount
          const supply = BigInt(state.get(supplyKey(assetId)) ?? cfg.maxSupplyRaw)
          const maxSupply = BigInt(cfg.maxSupplyRaw)
          if (supply + amountRaw > maxSupply) continue
          state.set(supplyKey(assetId), (supply + amountRaw).toString())
          state.set(balanceKey(assetId, target), (BigInt(state.get(balanceKey(assetId, target)) ?? '0') + amountRaw).toString())
          state.set(nonceKey(item.sender), (expectedNonce + 1n).toString())
          state.setJSON(faucetKey(target), { claimed: true })
          break
        }
        case 'welcome': {
          const target = (output.to as string) ?? item.sender
          if (state.has(welcomeKey(target))) continue
          const amountRaw = PAPUCOIN.welcomeAmount
          const supply = BigInt(state.get(supplyKey(assetId)) ?? cfg.maxSupplyRaw)
          const maxSupply = BigInt(cfg.maxSupplyRaw)
          if (supply + amountRaw > maxSupply) continue
          state.set(supplyKey(assetId), (supply + amountRaw).toString())
          state.set(balanceKey(assetId, target), (BigInt(state.get(balanceKey(assetId, target)) ?? '0') + amountRaw).toString())
          state.set(nonceKey(item.sender), (expectedNonce + 1n).toString())
          state.setJSON(welcomeKey(target), { claimed: true })
          break
        }
        default:
          continue
      }
    }
  },

  onTransfer(_transfer: Record<string, unknown>, _state: State): void {
    // on_transfer: reservado para recibir tokens de otros servicios (acuerdos futuros)
  },

  /** Registra config y balances iniciales en genesis */
  genesisSetup(state: State, opts: { issuer: string; initialBalances: Record<string, string>; maxSupply?: string }): void {
    const maxSupplyRaw = opts.maxSupply ? parseAmount(opts.maxSupply) : PAPUCOIN.maxSupply
    if (maxSupplyRaw > PAPUCOIN.maxSupply) throw new Error(`max supply excede el limite de ${formatRaw(PAPUCOIN.maxSupply)} ${PAPUCOIN.symbol}`)
    const cfg: PapucoinConfig = {
      symbol: PAPUCOIN.symbol,
      name: PAPUCOIN.name,
      decimals: PAPUCOIN.decimals,
      maxSupplyRaw: maxSupplyRaw.toString(),
      issuer: opts.issuer,
    }
    state.setJSON(configKey(), cfg)
    let total = 0n
    for (const [addr, amountStr] of Object.entries(opts.initialBalances)) {
      if (!isValidAddress(addr)) throw new Error(`Direccion invalida en genesis: ${addr}`)
      const raw = parseAmount(amountStr)
      state.set(balanceKey(PAPUCOIN.symbol, addr), raw.toString())
      total += raw
    }
    if (total > maxSupplyRaw) throw new Error(`Balance inicial (${formatRaw(total)} ${PAPUCOIN.symbol}) supera el max supply`)
    state.set(supplyKey(PAPUCOIN.symbol), total.toString())
  },
}

export function nonceOf(state: State, addr: string): bigint {
  return BigInt(state.get(nonceKey(addr)) ?? '1')
}

/** Balance actual en PAPU (crudo) */
export function balanceOf(state: State, addr: string): bigint {
  return BigInt(state.get(balanceKey(PAPUCOIN.symbol, addr)) ?? '0')
}

export function supplyOf(state: State): bigint {
  const cfg = state.getJSON<PapucoinConfig>(configKey())
  return BigInt(state.get(supplyKey(cfg?.symbol ?? PAPUCOIN.symbol)) ?? '0')
}

export function configOf(state: State): PapucoinConfig | undefined {
  return state.getJSON<PapucoinConfig>(configKey())
}

/** Construye un work item firmado para PAPUCOIN */
export function buildWorkItem(
  secretHex: string,
  sender: string,
  method: string,
  params: Record<string, string | number | boolean>,
  nonce: number,
  memo?: string,
): WorkItem {
  const base = { serviceId: PAPUCOIN.serviceId, method, params, sender, nonce, memo }
  const signature = signString(itemSignPayload(base), secretHex)
  return { ...base, signature, id: computeItemId(base) }
}