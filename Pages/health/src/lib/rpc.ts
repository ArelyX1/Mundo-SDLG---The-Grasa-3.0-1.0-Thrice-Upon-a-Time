import type { NetworkSnapshot, NodeState, RpcResponse, Sample } from './types';

/**
 * Habla con el RPC del nodo. Todo lo que este módulo afirma sobre la red sale de
 * aquí; no hay datos de ejemplo en ninguna parte del panel.
 *
 * El nodo no expone CORS, así que desde el navegador la llamada va a través del
 * proxy de Astro en /rpc. Para el desarrollo se reenvía al puerto 9944.
 */

export const DEFAULT_ENDPOINT = '/rpc';

/** Convierte 0x… en número. Devuelve null si no es un entero representable. */
export function hexToNumber(hex: string | undefined | null): number | null {
  if (!hex || hex === '0x') return null;
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? n : null;
}

/** Convierte un decimal como "703400000" en número, sin perder precisión grande. */
export function decToNumber(dec: string | undefined | null): number | null {
  if (!dec) return null;
  const n = Number(dec);
  return Number.isFinite(n) ? n : null;
}

export async function rpcCall<T>(
  endpoint: string,
  method: string,
  params: unknown = [],
  timeoutMs = 5000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as RpcResponse<T>;
    if ('error' in body) throw new Error(body.error.message);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

function blank(): NetworkSnapshot {
  return {
    state: 'offline',
    reachable: false,
    latencyMs: null,
    probes: [],
    health: null,
    sync: null,
    nodeName: null,
    chainName: null,
    version: null,
    runtime: null,
    params: null,
    supply: null,
    peers: [],
    listenAddresses: [],
    finalizedHead: null,
    latestHash: null,
    chainHeader: null,
    jamHeader: null,
    blockNumber: null,
    chainId: null,
    errors: [],
  };
}

/**
 * Toma una foto de todo lo que se puede leer del nodo en una pasada.
 *
 * Las llamadas van en paralelo y cada una falla por separado: que el grifo o la
 * oferta fallen no debe impedir mostrar la altura de bloque. Lo que no se puede
 * leer se queda en null y su error se anota.
 */
export async function takeSnapshot(endpoint: string): Promise<NetworkSnapshot> {
  const snap = blank();
  const errors: string[] = [];

  const guard = async <T>(label: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      errors.push(`${label}: ${(err as Error).message}`);
      return null;
    }
  };

  // La salud primero: decide si el nodo está vivo. El reloj mide solo este viaje
  // y, sobre todo, solo si respondió: medir cuánto tardó una conexión en fallar
  // da un número que parece una latencia y no lo es, y con el nodo apagado el
  // panel llegaba a plotting tiempos de fallo como si fueran de servicio.
  const sentAt = performance.now();
  const health = await guard('system_health', () => rpcCall<NetworkSnapshot['health']>(endpoint, 'system_health'));
  if (health === null) {
    snap.state = 'offline';
    snap.reachable = false;
    snap.errors = errors;
    snap.latencyMs = null;
    return snap;
  }

  snap.reachable = true;
  snap.state = 'online';
  snap.health = health;
  snap.latencyMs = Math.round(performance.now() - sentAt);

  const [name, chain, version, sync, runtime, params, supply, peers, addrs, finalized, latest, chainId] =
    await Promise.all([
      guard('system_name', () => rpcCall<string>(endpoint, 'system_name')),
      guard('system_chain', () => rpcCall<string>(endpoint, 'system_chain')),
      guard('system_version', () => rpcCall<string>(endpoint, 'system_version')),
      guard('system_syncState', () => rpcCall<NetworkSnapshot['sync']>(endpoint, 'system_syncState')),
      guard('state_getRuntimeVersion', () => rpcCall<NetworkSnapshot['runtime']>(endpoint, 'state_getRuntimeVersion')),
      guard('papucoin_chainParams', () => rpcCall<NetworkSnapshot['params']>(endpoint, 'papucoin_chainParams')),
      guard('papucoin_supply', () => rpcCall<NetworkSnapshot['supply']>(endpoint, 'papucoin_supply')),
      guard('system_peers', () => rpcCall<unknown[]>(endpoint, 'system_peers')),
      guard('system_localListenAddresses', () => rpcCall<string[]>(endpoint, 'system_localListenAddresses')),
      guard('chain_getFinalizedHead', () => rpcCall<string>(endpoint, 'chain_getFinalizedHead')),
      guard('chain_getBlockHash', () => rpcCall<string>(endpoint, 'chain_getBlockHash', [99999999])),
      guard('eth_chainId', () => rpcCall<string>(endpoint, 'eth_chainId')),
    ]);

  snap.nodeName = name;
  snap.chainName = chain;
  snap.version = version;
  snap.sync = sync;
  snap.runtime = runtime;
  snap.params = params;
  snap.supply = supply;
  snap.peers = peers ?? [];
  snap.listenAddresses = addrs ?? [];
  snap.finalizedHead = finalized;
  snap.latestHash = latest;
  snap.chainId = chainId;

  // La cabecera JAM lleva lo que el panel muestra por bloque: autor, epoch, slot.
  if (finalized) {
    const [chainHeader, jamHeader] = await Promise.all([
      guard('chain_getHeader', () => rpcCall<NetworkSnapshot['chainHeader']>(endpoint, 'chain_getHeader', [finalized])),
      guard('jam_getHeader', () => rpcCall<NetworkSnapshot['jamHeader']>(endpoint, 'jam_getHeader', [finalized])),
    ]);
    snap.chainHeader = chainHeader;
    snap.jamHeader = jamHeader;
    snap.blockNumber = hexToNumber(chainHeader?.number) ?? jamHeader?.number ?? null;
  } else {
    snap.blockNumber = hexToNumber(latest);
  }

  snap.errors = errors;
  return snap;
}

/** Convierte una foto en la muestra que consume el histórico. */
export function toSample(snap: NetworkSnapshot, at: number): Sample {
  const gap =
    snap.sync?.currentBlock && snap.sync?.highestBlock
      ? Math.max(0, hexToNumber(snap.sync.highestBlock)! - hexToNumber(snap.sync.currentBlock)!)
      : null;

  return {
    t: at,
    state: snap.state,
    reachable: snap.reachable,
    latencyMs: snap.latencyMs,
    blockNumber: snap.blockNumber,
    peers: snap.health?.peers ?? null,
    syncGap: gap,
    epoch: snap.jamHeader?.epoch ?? null,
    timeSlot: snap.jamHeader?.timeSlotIndex ?? null,
    extrinsics: snap.jamHeader?.extrinsics ?? null,
    supply: decToNumber(snap.supply?.supply),
    supplyRaw: decToNumber(snap.supply?.raw),
    storageItems: snap.supply?.storageItems ?? null,
    storageOctets: snap.supply?.storageOctets ?? null,
    pending: snap.params?.queue?.pending ?? null,
    isSyncing: snap.health?.isSyncing ?? null,
  };
}

/**
 * Decide si el nodo está apagado o arrancando.
 *
 * No es una diferencia que el RPC reports: cuando no hay nadie escuchando, la
 * llamada falla de inmediato. Lo que separa "apagado" de "arrancando" es que
 * un nodo que sube suele tardar un poco en abrir el puerto, así que se cuentan
 * los intentos seguidos y se considera arrancando mientras sean pocos.
 */
export function classifyState(
  snap: NetworkSnapshot,
  consecutiveFailures: number,
  sawItOnline: boolean,
): NodeState {
  if (snap.state === 'online') return 'online';
  if (!sawItOnline && consecutiveFailures < 8) return 'starting';
  if (consecutiveFailures < 3) return 'starting';
  return 'offline';
}

/** Formatea una duración en segundos a algo legible: 1d 4h 12m 03s. */
export function formatUptime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${h}h ${pad(m)}m ${pad(s)}s` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Formatea PAPU a partir de un entero con 12 decimales. */
export function formatPapu(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '—';
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isFinite(n)) return '—';
  return (n / 1e12).toLocaleString('es', { maximumFractionDigits: 6 });
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es');
}

export function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString('es', { hour12: false });
}
