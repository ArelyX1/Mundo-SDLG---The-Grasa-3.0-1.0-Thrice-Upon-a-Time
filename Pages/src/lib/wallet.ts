import type { ChainParams, Supply } from './types';

/**
 * Puente con MetaMask y con el RPC del nodo.
 *
 * El nodo no es una cadena EVM completa: ethereum_requestAccounts y
 * wallet_switchEthereumChain existen en la interfaz de la wallet pero no los
 * atiende un nodo de JAM. Lo que sí hace el nodo es eth_chainId, eth_blockNumber
 * y eth_getBalance, así que la parte honesta es leer el estado por el RPC y usar
 * la wallet solo para la dirección. Está anotado en la propia interfaz para que
 * no parezca que la cadena está conectada cuando no lo está.
 */

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function getProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  return window.ethereum ?? null;
}

export function hasWallet(): boolean {
  return getProvider() !== null;
}

/** Pide las cuentas. Devuelve la primera dirección o null si el usuario dice que no. */
export async function requestAccounts(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const accounts = (await provider.request({ method: 'ethereum_requestAccounts' })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Cuenta ya autorizada, sin abrir la ventana de MetaMask. */
export async function getAccount(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function getWalletChainId(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    return (await provider.request({ method: 'eth_chainId' })) as string;
  } catch {
    return null;
  }
}

export async function getWalletBalance(address: string): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    return (await provider.request({
      method: 'eth_getBalance',
      params: [address, 'latest'],
    })) as string;
  } catch {
    return null;
  }
}

// ---------- RPC del nodo ----------

export async function rpc<T>(endpoint: string, method: string, params: unknown = []): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface PapuBalance {
  address: string;
  balance: string;
  decimals: number;
  nonce: number;
  raw: string;
}

export function getPapuBalance(endpoint: string, address: string): Promise<PapuBalance> {
  // La dirección va como string suelto: un objeto devuelve
  // "address must be a string".
  return rpc<PapuBalance>(endpoint, 'papucoin_balance', [address]);
}

export function getSupply(endpoint: string): Promise<Supply> {
  return rpc<Supply>(endpoint, 'papucoin_supply');
}

export function getParams(endpoint: string): Promise<ChainParams> {
  return rpc<ChainParams>(endpoint, 'papucoin_chainParams');
}

export function getBlockNumber(endpoint: string): Promise<string> {
  return rpc<string>(endpoint, 'eth_blockNumber');
}

/** El emisor es la cuenta que puede emitir; útil para explicarle el rol al usuario. */
export function issuerOf(params: ChainParams | null): string | null {
  return params?.issuer ?? null;
}

/** Convierte PAPU con 12 decimales a texto legible. */
export function formatPapu(raw: string | null | undefined): string {
  if (!raw) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '—';
  return (n / 1e12).toLocaleString('es', { maximumFractionDigits: 6 });
}

/** Dirección larga, con puntos suspensivos por el medio. */
export function shortenAddress(addr: string, head = 8, tail = 6): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

/** Compara dos identificadores de cadena venga como venga: 0x1400 o 5120. */
export function sameChain(a: string | number | null, b: string | number | null): boolean {
  if (a === null || b === null) return false;
  const norm = (v: string | number) => (typeof v === 'number' ? v.toString() : Number(v).toString());
  return norm(a) === norm(b);
}
