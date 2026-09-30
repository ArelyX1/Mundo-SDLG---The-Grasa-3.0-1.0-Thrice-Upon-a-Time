/**
 * Tipos del RPC de strawberry, tomados de respuestas reales del nodo en modo
 * dev. No son inventados: cada forma de aquí coincide con lo que devolvió
 * `cmd/strawberry/rpc.go` al consultarlo.
 */

export type RpcResult<T> = { jsonrpc: '2.0'; id: number; result: T };
export type RpcError = { jsonrpc: '2.0'; id: number; error: { code: number; message: string } };
export type RpcResponse<T> = RpcResult<T> | RpcError;

export interface Health {
  isSyncing: boolean;
  peers: number;
  shouldHavePeers: boolean;
}

export interface SyncState {
  currentBlock: string;
  highestBlock: string;
}

export interface ChainParams {
  bridgeAddress: string;
  decimals: number;
  evm: { chainId: number; decimals: number; name: string; symbol: string };
  issuer: string;
  network: string;
  queue: { pending: number; slots: number };
  serviceId: number;
  serviceName: string;
  symbol: string;
}

export interface Supply {
  decimals: number;
  firstNonce: number;
  maxSupply: string;
  maxSupplyRaw: string;
  raw: string;
  stateRoot: string;
  storageItems: number;
  storageOctets: number;
  supply: string;
  transferFee: string;
}

export interface ChainHeader {
  parentHash: string;
  number: string;
  stateRoot: string;
  extrinsicsRoot: string;
  digest: { logs: string[] };
}

export interface JamHeader {
  blockAuthorIndex: number;
  epoch: number;
  extrinsicHash: string;
  extrinsics: number;
  hash: string;
  number: number;
  parentHash: string;
  resultingStateRoot: string;
  stateRoot: string;
  timeSlotIndex: number;
}

export interface Block {
  block: { extrinsics: unknown[]; header: ChainHeader };
  justifications: null;
}

export interface RuntimeVersion {
  apis: unknown[];
  authoringVersion: number;
  implName: string;
  implVersion: number;
  specName: string;
  specVersion: number;
  stateVersion: number;
  transactionVersion: number;
}

export type NodeState = 'offline' | 'starting' | 'online';

export interface Probe {
  at: number;
  ok: boolean;
  ms: number;
  error?: string;
}

/** Una muestra del histórico que alimenta los gráficos. */
export interface Sample {
  t: number;
  state: NodeState;
  reachable: boolean;
  latencyMs: number | null;
  blockNumber: number | null;
  peers: number | null;
  syncGap: number | null;
  epoch: number | null;
  timeSlot: number | null;
  extrinsics: number | null;
  supply: number | null;
  supplyRaw: number | null;
  storageItems: number | null;
  storageOctets: number | null;
  pending: number | null;
  isSyncing: boolean | null;
}

export interface NetworkSnapshot {
  state: NodeState;
  reachable: boolean;
  latencyMs: number | null;
  probes: Probe[];
  health: Health | null;
  sync: SyncState | null;
  nodeName: string | null;
  chainName: string | null;
  version: string | null;
  runtime: RuntimeVersion | null;
  params: ChainParams | null;
  supply: Supply | null;
  peers: unknown[];
  listenAddresses: string[];
  finalizedHead: string | null;
  latestHash: string | null;
  chainHeader: ChainHeader | null;
  jamHeader: JamHeader | null;
  blockNumber: number | null;
  chainId: string | null;
  errors: string[];
}
