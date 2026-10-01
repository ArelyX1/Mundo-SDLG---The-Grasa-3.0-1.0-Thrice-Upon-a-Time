/**
 * Descubrimiento de nodos y eleccion.
 *
 * El sitio puede mirar varios nodos: los que declare NODES en el .env, o los
 * que encuentre barriendo los puertos de localhost cuando no se declara nada.
 * El navegador no puede llamar a los nodos directamente porque no mandan
 * cabeceras CORS, asi que todo pasa por /rpc?node=<id> y este modulo solo
 * elige a quien se le pregunta.
 */

export interface NodeEntry {
  id: string;
  url: string;
}

export interface NodeProbe {
  id: string;
  url: string;
  alive: boolean;
  name: string | null;
  chain: string | null;
  version: string | null;
  blockNumber: number | null;
  error?: string;
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

/** El endpoint de RPC para un nodo concreto. */
export function rpcUrl(id: string): string {
  return `/rpc?node=${encodeURIComponent(id)}`;
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
    const base: NodeProbe = {
      id: node.id,
      url: node.url,
      alive: false,
      name: null,
      chain: null,
      version: null,
      blockNumber: null,
    };
    try {
      const call = (method: string, params: unknown = []) =>
        fetch(rpcUrl(node.id), {
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

      const [health, name, chain, version, block] = await Promise.all([
        call('system_health'),
        call('system_name'),
        call('system_chain'),
        call('system_version'),
        call('eth_blockNumber'),
      ]);

      return {
        ...base,
        alive: true,
        name: name ?? null,
        chain: chain ?? null,
        version: version ?? null,
        blockNumber: block ? Number.parseInt(String(block), 16) : null,
      };
    } catch (err) {
      return { ...base, error: (err as Error).message };
    }
  });
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
 * el orden en que el servidor los declaro.
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
