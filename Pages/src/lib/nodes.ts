/**
 * Descubrimiento de nodos y eleccion.
 *
 * La web se entera de quién hay en la red sin que nadie le diga la lista
 * completa. Basta con un nodo alcanzable (el "seed"): se le pregunta por
 * network_map y responde "yo soy este, y mis peers son estos, con sus
 * direcciones P2P". Con eso el panel construye la lista de nodos, prueba a
 * cada uno por sus puertos RPC candidatos, y muestra la red.
 *
 * El navegador no puede llamar a los nodos directamente porque no mandan
 * cabeceras CORS, asi que todo pasa por /rpc?node=<destino> y este modulo solo
 * decide a quien se le pregunta. Cuando <destino> es una URL completa, el proxy
 * reenvia ahi; cuando es un numero, al que la lista NODES del .env declara.
 *
 * La red tolera que cualquier validador caiga: con --skip-missing-authors el
 * suplente escribe el turno del autor muerto y la cadena sigue avanzando.
 * Cuando el nodo vuelve, se pone al dia solo. El panel muestra esa realidad:
 * no alarmarse porque un validador este apagado si la cadena sigue viva.
 */

export interface NodeEntry {
  id: string;
  url: string;
  /**
   * Otras URLs de RPC a probar para llegar a este mismo nodo. La red solo
   * anuncia direcciones P2P de sus peers; el puerto RPC hay que probarlo. El
   * primero que responda gana.
   */
  candidates?: string[];
  /** La direccion P2P que la red anuncio para este nodo, si llegue a el por discovery. */
  p2pAddress?: string;
  /** El indice de validador que la red anuncio, si lo conoce. */
  validatorIndex?: number;
}

export interface NodeProbe {
  id: string;
  url: string;
  alive: boolean;
  name: string | null;
  chain: string | null;
  version: string | null;
  blockNumber: number | null;
  /** Indice del validador, tal como la red lo declara en network_map. */
  validatorIndex: number | null;
  /** Slot mas alto que este nodo ha visto en su cabecera JAM. */
  slot: number | null;
  /** Autor del ultimo bloque que este nodo tiene. */
  lastAuthor: number | null;
  /** La direccion P2P a traves de la cual se llego a este nodo. */
  p2pAddress?: string;
  error?: string;
}

/**
 * Foto de la red entera: que validadores hay, cuales responden, y si la
 * cadena sigue avanzando aunque falte alguno.
 */
export interface NetworkHealth {
  total: number;
  alive: number;
  down: number;
  /** Altura de bloque comun entre los nodos vivos. */
  chainTip: number | null;
  /** Indice del autor del ultimo bloque visto por cualquier nodo vivo. */
  lastAuthor: number | null;
  /** Si los nodos vivos estan de acuerdo en la altura. */
  tipsAgree: boolean;
}

const STORAGE_KEY = 'sdlg.node';

/** Lee /nodes: la lista que el servidor sabe mirar. */
export async function fetchNodes(endpoint = '/nodes'): Promise<{
  nodes: NodeEntry[];
  default: string;
  source: string;
}> {
  const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/**
 * El endpoint de RPC para un nodo concreto.
 *
 * Un id que sea una URL completa le dice al proxy "pregunta ahi". Un id
 * numerico es un indice en la lista NODES del .env.
 */
export function rpcUrl(id: string): string {
  if (/^https?:\/\//i.test(id)) return `/rpc?node=${encodeURIComponent(id)}`;
  return `/rpc?node=${encodeURIComponent(id)}`;
}

/**
 * Lo que network_map devuelve en un nodo. "self" es el nodo que responde; los
 * peers son el conjunto de validadores que la cadena declaro, cada uno con su
 * direccion P2P configurada y si este nodo esta conectado a el ahorita. No
 * son solo los conectados: un validador apagado sigue en la lista, que es
 * como el panel sabe que falta.
 */
export interface NetMap {
  self: NetMapPeer;
  peers: NetMapPeer[];
}

export interface NetMapPeer {
  name?: string;
  version?: string;
  chain?: string;
  listenAddresses?: string[];
  rpcPort?: number;
  validatorIndex?: number;
  p2pAddress?: string;
  connected?: boolean;
  announcing?: boolean;
  self?: boolean;
}

/**
 * De una direccion P2P ("[::]:30334" o "192.168.1.10:30334") saca el host y
 * el puerto.
 */
function splitP2P(addr: string): { host: string; port: number } | null {
  if (addr.startsWith('[')) {
    const close = addr.indexOf(']');
    if (close < 0) return null;
    const host = addr.slice(1, close);
    const port = Number(addr.slice(close + 2));
    if (!host || !Number.isFinite(port)) return null;
    return { host, port };
  }
  const i = addr.lastIndexOf(':');
  if (i < 0) return null;
  const host = addr.slice(0, i);
  const port = Number(addr.slice(i + 1));
  if (!host || !Number.isFinite(port)) return null;
  return { host, port };
}

/**
 * Puertos RPC candidatos para un validador.
 *
 * La red anuncia direcciones P2P, que no dicen nada del puerto RPC. Se prueban
 * en orden, usando el indice del validador para la convencion del devnet: si
 * este nodo es el indice 0 y escucha RPC en 9944, el indice 1 suele estar en
 * 9945, y el 2 en 9946. Luego van el RPC del propio nodo y el 9944 por defecto.
 */
export function candidateRpcPorts(
  selfRpcPort: number,
  selfIndex: number,
  peerIndex: number,
  p2pAddress: string,
): number[] {
  const out: number[] = [];
  const push = (p: number) => {
    if (Number.isFinite(p) && p > 0 && p < 65536 && !out.includes(p)) out.push(p);
  };
  // Convencion del devnet: el RPC de cada validador se corre con el mismo
  // desplazamiento que su indice.
  push(selfRpcPort + (peerIndex - selfIndex));
  push(selfRpcPort);
  push(9944 + peerIndex);
  push(9944);
  const split = splitP2P(p2pAddress);
  if (split && split.port) {
    // Convencion del devnet tambien: p2p 30334+i -> rpc 9944+i.
    push(split.port - 21390);
  }
  return out;
}

/**
 * Descubre la red a partir de un nodo alcanzable.
 *
 * Le pregunta por network_map: el nodo se describe a si mismo ("self") y lista
 * el conjunto de validadores con sus direcciones P2P configuradas. Devuelve
 * una lista de nodos con las URLs RPC a probar, incluyendo el seed, y marca
 * quienes estan conectados a ese nodo.
 */
export async function discoverNetwork(seed: NodeEntry): Promise<NodeEntry[]> {
  const res = await fetch(rpcUrl(seed.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'network_map', params: [] }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  const map = body.result as NetMap;

  const self = map.self ?? {};
  const selfIndex = self.validatorIndex ?? 0;
  const selfRpcPort = self.rpcPort ?? 9944;
  const out: NodeEntry[] = [
    {
      id: 'self',
      url: seed.url,
      p2pAddress: self.p2pAddress,
      validatorIndex: selfIndex,
    },
  ];

  const visited = new Set<number>([selfIndex]);
  for (const peer of map.peers ?? []) {
    const idx = peer.validatorIndex;
    if (idx === undefined) continue;
    if (visited.has(idx)) continue;
    visited.add(idx);
    const split = splitP2P(peer.p2pAddress ?? '');
    // El host que se ve de la conexion es el de la maquina real del peer. Pero
    // puede ser una direccion que esta maquina no alcance (las ULA IPv6, por
    // ejemplo), asi que se prueban tambien el host de los candidatos: el
    // configurado y localhost, que es lo que une a nodos de una misma maquina.
    const hosts: string[] = [];
    const pushHost = (h: string) => {
      if (h && h !== '::' && h !== '0.0.0.0' && !hosts.includes(h)) hosts.push(h);
    };
    if (split?.host) pushHost(split.host);
    if (peer.p2pAddress && !peer.p2pAddress.startsWith('[')) {
      const cfg = splitP2P(peer.p2pAddress);
      if (cfg?.host) pushHost(cfg.host);
    }
    pushHost('127.0.0.1');
    const ports = candidateRpcPorts(selfRpcPort, selfIndex, idx, peer.p2pAddress ?? '');
    const urls: string[] = [];
    for (const h of hosts) {
      for (const p of ports) {
        const u = `http://${h}:${p}`;
        if (!urls.includes(u)) urls.push(u);
      }
    }
    out.push({
      id: String(idx),
      url: urls[0] ?? '',
      candidates: urls.slice(1),
      p2pAddress: peer.p2pAddress,
      validatorIndex: idx,
    });
  }
  return out;
}

/**
 * Pregunta a cada nodo si esta vivo.
 *
 * La concurrencia va limitada a proposito. Todas las llamadas salen por el proxy
 * del sitio, o sea al mismo origen, y el navegador no deja mas de seis
 * conexiones abiertas a un host: disparando dieciocho nodos por cinco llamadas
 * cada uno, las ultimas se quedan esperando en la cola y expira el plazo antes
 * de llegar a salir. Con lo que los nodos vivos se perdian por el limite del
 * navegador y no por estar apagados.
 */
async function withLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function probeNodes(nodes: NodeEntry[]): Promise<NodeProbe[]> {
  return await withLimit(nodes, 4, async (node) => {
    const urls = [node.url, ...(node.candidates ?? [])];
    let last: NodeProbe | null = null;
    for (const url of urls) {
      if (!url) continue;
      last = await probeOne(node, url);
      if (last.alive) return last;
    }
    return last ?? {
      id: node.id,
      url: node.url,
      alive: false,
      name: null,
      chain: null,
      version: null,
      blockNumber: null,
      validatorIndex: node.validatorIndex ?? null,
      slot: null,
      lastAuthor: null,
      p2pAddress: node.p2pAddress,
      error: 'sin URLs que probar',
    };
  });
}

async function probeOne(node: NodeEntry, url: string): Promise<NodeProbe> {
  const base: NodeProbe = {
    id: node.id,
    url,
    alive: false,
    name: null,
    chain: null,
    version: null,
    blockNumber: null,
    validatorIndex: node.validatorIndex ?? null,
    slot: null,
    lastAuthor: null,
    p2pAddress: node.p2pAddress,
  };
  try {
    const call = (method: string, params: unknown = []) =>
      fetch(rpcUrl(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(6000),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => {
          if (b.error) throw new Error(b.error.message);
          return b.result;
        });

    const [health, name, chain, version, block, header] = await Promise.all([
      call('system_health'),
      call('system_name'),
      call('system_chain'),
      call('system_version'),
      call('eth_blockNumber'),
      call('jam_getHeader', [null]),
    ]);

    const blockNumber = block ? Number.parseInt(String(block), 16) : null;
    return {
      ...base,
      alive: true,
      name: name ?? null,
      chain: chain ?? null,
      version: version ?? null,
      blockNumber,
      slot: header?.timeSlotIndex ?? null,
      lastAuthor: header?.blockAuthorIndex ?? null,
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

/**
 * Resumen de la red a partir de las sondas. Solo cuenta los nodos vivos para
 * la altura comun: un nodo apagado no tiene altura que comparar.
 */
export function networkHealth(probes: NodeProbe[]): NetworkHealth {
  const alive = probes.filter((p) => p.alive);
  const tips = alive.map((p) => p.blockNumber).filter((n): n is number => n !== null);
  const chainTip = tips.length > 0 ? Math.max(...tips) : null;
  const tipsAgree = tips.length <= 1 || tips.every((t) => t === tips[0]);
  const authors = alive.map((p) => p.lastAuthor).filter((n): n is number => n !== null);
  return {
    total: probes.length,
    alive: alive.length,
    down: probes.length - alive.length,
    chainTip,
    lastAuthor: authors.length > 0 ? authors[authors.length - 1] : null,
    tipsAgree,
  };
}

/** El nodo elegido la ultima vez, si sigue estando en la lista. */
export function rememberedNode(nodes: NodeEntry[], fallback: string): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && nodes.some((n) => n.id === saved)) return saved;
  } catch {
    // Modo privado o almacenamiento bloqueado: se sigue con el de por defecto.
  }
  return fallback;
}

export function rememberNode(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Si no se puede guardar, el selector sigue funcionando en esta sesion.
  }
}

/**
 * El nodo que hay que mirar.
 *
 * Con uno solo vivo no hay decision que tomar. Con varios, gana el que la
 * persona eligio; si no hay eleccion guardada, el primero que responde, que es
 * el que el mapa de la red puso primero.
 */
export function pickNode(probes: NodeProbe[], preferred: string | null): NodeProbe | null {
  const alive = probes.filter((p) => p.alive);
  if (alive.length === 0) return null;
  if (alive.length === 1) return alive[0];
  if (preferred) {
    const chosen = alive.find((p) => p.id === preferred);
    if (chosen) return chosen;
  }
  return alive[0];
}

/**
 * Expande la lista de nodos: el servidor da el seed (lo que declara NODES), y
 * la red se descubre sola preguntandole a ese seed por network_map. Si el seed
 * no responde o el servidor ya dio la lista completa, se queda como estaba.
 */
export async function expandWithDiscovery(
  current: NodeEntry[],
): Promise<{ nodes: NodeEntry[]; discovered: boolean }> {
  if (current.length === 0) return { nodes: current, discovered: false };
  const seed = current[0];
  try {
    const discovered = await discoverNetwork(seed);
    return { nodes: discovered, discovered: true };
  } catch {
    // El seed no esta o no habla network_map (nodo viejo). La lista sin expandir
    // sigue siendo util.
    return { nodes: current, discovered: false };
  }
}