import { readFileSync } from 'node:fs'
import { State } from './chain/state.js'
import { ns } from './chain/state.js'
import { papucoinService } from './services/papucoin/service.js'
import { registry } from './services/registry.js'

export interface GenesisValidator {
  name: string
  publicKey: string
}

export interface GenesisConfig {
  network: string
  timeslotSecs: number
  cores: number
  createdAt: string
  /** Inicio del epoch de red (ms epoch). Los slots se derivan de aqui. */
  epochStart?: number
  validators: GenesisValidator[]
  seedPeers: string[]
  economy: {
    maxSupply: string
    decimals: number
    issuer: string
    initialBalances: Record<string, string>
  }
}

/** Inicio de epoch de una red: epochStart o, en su defecto, createdAt. */
export function networkEpochStart(cfg: GenesisConfig): number {
  if (cfg.epochStart !== undefined) return cfg.epochStart
  const t = Date.parse(cfg.createdAt)
  return Number.isFinite(t) ? t : Date.now()
}

/** Estado raiz del genesis: registra servicios y la economia CRYPTOPAPU. */
export function buildGenesisState(cfg: GenesisConfig): State {
  const state = new State()
  state.setJSON(ns('system', ['network']), { name: cfg.network, cores: cfg.cores, timeslotSecs: cfg.timeslotSecs })
  state.setJSON(ns('system', ['services']), registry.list().map((s) => ({ id: s.id, name: s.name, symbol: s.symbol ?? null })))
  papucoinService.genesisSetup!(state, {
    issuer: cfg.economy.issuer,
    initialBalances: cfg.economy.initialBalances,
    maxSupply: cfg.economy.maxSupply,
  })
  return state
}

export function loadGenesis(path: string): GenesisConfig {
  const raw = readFileSync(path, 'utf8')
  const cfg = JSON.parse(raw) as GenesisConfig
  if (!cfg.network || !cfg.validators?.length) throw new Error(`Genesis invalido en ${path}`)
  return cfg
}