import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// El nodo no manda cabeceras CORS, asi que el navegador no puede llamarlo desde
// otro origen y todo pasa por /rpc. serve.mjs ya hace ese reenvio para dist, pero
// el servidor de desarrollo de Astro no lo hacia, y por eso `npm run dev`
// servia las paginas sin datos: la pagina abria, y cada llamada al nodo daba 404
// sin explicacion.
//
// Este plugin cubre el desarrollo, de modo que las tres formas de arrancar —dev,
// preview y serve— se comportan igual.
function rpcProxy() {
  const target = process.env.RPC_TARGET ?? 'http://127.0.0.1:9944';

  // Se replica la misma lista de nodos que usa serve.mjs, para que el selector
  // de la pagina tenga sentido tambien en desarrollo y no solo al servir dist.
  const SCAN_FROM = Number(process.env.SCAN_FROM ?? 9944);
  const SCAN_TO = Number(process.env.SCAN_TO ?? 9960);

  const configured = (process.env.NODES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let nodes = configured;
  if (nodes.length === 0) {
    nodes = process.env.RPC_TARGET
      ? [process.env.RPC_TARGET]
      : Array.from({ length: SCAN_TO - SCAN_FROM + 1 }, (_, i) => `http://127.0.0.1:${SCAN_FROM + i}`);
  }
  const defaultNode = process.env.NODE_DEFAULT ?? '0';

  async function forward(req, res, to) {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('el RPC del nodo solo acepta POST');
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    try {
      const upstream = await fetch(to, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body.length ? body : undefined,
        signal: AbortSignal.timeout(8000),
      });
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(text);
    } catch (err) {
      // 503 con un JSON-RPC de error es lo que el panel lee como apagado.
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32000, message: `nodo inaccesible en ${to}: ${err.message}` },
        }),
      );
    }
  }

  return {
    name: 'rpc-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/nodes') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(
            JSON.stringify({
              nodes: nodes.map((url, i) => ({ id: String(i), url })),
              default: defaultNode,
              source: configured.length ? 'NODES' : process.env.RPC_TARGET ? 'RPC_TARGET' : 'scan',
              scanned: `${SCAN_FROM}-${SCAN_TO}`,
            }),
          );
          return;
        }
        if (url.pathname !== '/rpc') return next();
        const which = url.searchParams.get('node');
        const id = which !== null && /^[0-9]+$/.test(which) ? Number(which) : Number(defaultNode);
        return forward(req, res, nodes[id] ?? target);
      });
    },
  };
}

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [rpcProxy()],
    server: {
      port: 4321,
    },
  },
});
