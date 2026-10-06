#!/usr/bin/env node
/*
 * Servidor estático con proxy a /rpc.
 *
 * El nodo no manda cabeceras CORS, así que el navegador no puede llamarlo desde
 * otro origen. Esto resuelve las dos cosas de una vez: sirve las páginas y
 * reenvía /rpc al nodo. No depende de cómo astro decida interpretar su
 * configuración de proxy, que es justo lo que falla al usar astro preview.
 *
 * Uso:
 *   node serve.mjs                      # sirve dist/ en 4321, rpc a 9944
 *   PORT=5000 RPC_TARGET=http://nodo:9944 node serve.mjs
 *   HOST=0.0.0.0 node serve.mjs         # para que otras maquinas entren al panel
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = fileURLToPath(new URL('.', import.meta.url));

// Configuracion desde archivos .env, con la misma precedencia que usa Vite:
//   .env -> .env.local -> .env.<modo> -> .env.<modo>.local
// Gana el ultimo, pero lo que ya venia del entorno real gana sobre todos los
// archivos, que es como se comprueba en produccion sin editar nada.
//
// El parser es propio a proposito: process.loadEnvFile no sobreescribe lo que ya
// esta puesto, asi que con el .env cargado el .env.local se ignoraba y el orden
// de precedencia no se cumplia.
function parseEnv(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    // comillas envolventes, y \ escapado minimo
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function loadEnv() {
  const mode = process.env.NODE_ENV || 'development';
  const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];

  // Lo que venia del entorno antes de tocar nada: intocable.
  const realEnv = new Set(Object.keys(process.env));
  const loaded = [];

  for (const file of files) {
    const path = join(here, file);
    if (!existsSync(path)) continue;
    try {
      const parsed = parseEnv(await readFile(path, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (realEnv.has(key)) continue;
        process.env[key] = value;
      }
      loaded.push(file);
    } catch (err) {
      console.warn(`no se pudo leer ${file}: ${err.message}`);
    }
  }
  return loaded;
}

// Las variables se leyen despues de cargar los .env, asi que todo lo que
// depende de ellas arranca cuando la carga ha terminado.
const envFiles = await loadEnv();

const root = resolve(here, process.env.SERVE_DIR ?? 'dist');
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 4321);
const rpcTarget = process.env.RPC_TARGET ?? 'http://127.0.0.1:9944';

// Rango que se barre cuando no se dice cuantos nodos hay. El nodo escucha en
// 9944 por defecto, asi que varios nodos locales seria 9944, 9945 y hacia ahi.
const SCAN_FROM = Number(process.env.SCAN_FROM ?? 9944);
const SCAN_TO = Number(process.env.SCAN_TO ?? 9960);

/**
 * Los nodos que este sitio puede mirar.
 *
 * Se declaran con NODES, separado por comas. Cada entrada puede ser una URL
 * sola o un alias: "nodo-0=http://192.168.1.10:9944". El alias es lo que la
 * pagina muestra y lo que se pone en /rpc?node=<nombre>, para no escribir IPs
 * a mano. Si no se declara nada se barren los puertos de localhost del rango,
 * que es lo que hace util la pagina en local sin tener que configurar nada.
 * RPC_TARGET manda sobre el primero: quien lo tenga puesto quiere ese nodo por
 * encima de cualquier barrido.
 */
function configuredNodes() {
  const list = (process.env.NODES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const eq = item.indexOf('=');
      if (eq > 0) {
        const name = item.slice(0, eq).trim();
        return name ? { name, url: item.slice(eq + 1).trim() } : { name: null, url: item };
      }
      return { name: null, url: item };
    });

  if (list.length > 0) return list;
  if (process.env.RPC_TARGET) return [{ name: null, url: process.env.RPC_TARGET }];

  const found = [];
  for (let p = SCAN_FROM; p <= SCAN_TO; p++) {
    if (p === Number(process.env.PORT)) continue;
    found.push({ name: null, url: `http://127.0.0.1:${p}` });
  }
  return found;
}

const NODES = configuredNodes();
const DEFAULT_NODE = process.env.NODE_DEFAULT ?? '0';

/** La URL de un nodo por su alias. No toca indices ni URLs completas. */
function urlByAlias(alias) {
  const found = NODES.find((n) => n.name === alias);
  return found ? found.url : null;
}

/** A que nodo va /rpc sin que diga quien: el de por defecto, por nombre o por
 *  indice, y si no se encuentra, el RPC_TARGET. */
function defaultTarget() {
  return urlByAlias(DEFAULT_NODE) ?? NODES[Number(DEFAULT_NODE)]?.url ?? rpcTarget;
}

/** A que nodo va /rpc cuando piden un destino concreto. Un alias gana sobre un
 *  indice con el mismo valor: "0" es el alias "0" si alguien lo declaro. */
function resolveTarget(which) {
  if (/^https?:\/\//i.test(which)) return which;
  const byAlias = urlByAlias(which);
  if (byAlias) return byAlias;
  if (/^[0-9]+$/.test(which)) return NODES[Number(which)]?.url ?? null;
  return null;
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

async function proxy(req, res, target) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: body && body.length ? body : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': 'application/json; charset=utf-8',
      // El panel sonea cada 2s; sin esto el navegador cachea el 404 del nodo.
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch (err) {
    // El panel distingue "nodo apagado" de "nodo roto" por esto: un 503 con un
    // cuerpo JSON válido significa que no hay nadie escuchando.
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: `nodo inaccesible en ${target}: ${err.message}` },
      }),
    );
  }
}

async function serveFile(res, filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': types[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': data.length,
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

/** /nodes: que nodos puede mirar este sitio. Lo lee la pagina al abrirse. */
function listNodes(res) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(
    JSON.stringify({
      nodes: NODES.map((n, i) => ({ id: n.name ?? String(i), url: n.url })),
      default: DEFAULT_NODE,
      // Se dice de donde salio la lista, porque "no hay ninguno" y "no hemos
      // buscado" son cosas distintas y no deben verse igual.
      source: process.env.NODES ? 'NODES' : process.env.RPC_TARGET ? 'RPC_TARGET' : 'scan',
      scanned: `${SCAN_FROM}-${SCAN_TO}`,
    }),
  );
}

const server = createServer(async (req, res) => {
  if (req.url === '/nodes') return listNodes(res);

  // /rpc?node=<id> elige a que nodo va la llamada. Sin el, el de por defecto.
  //
  // El id puede ser un alias declarado en NODES ("nodo-0"), un indice en NODES,
  // o una URL completa: cuando la pagina se descubrio la red sola con
  // network_map, el navegador le dice al proxy "pregunta a http://<ip>:<puerto>"
  // y el proxy reenvia ahi directamente.
  if (req.url === '/rpc' || req.url.startsWith('/rpc?')) {
    const which = new URL(req.url, 'http://localhost').searchParams.get('node');
    const target = which === null ? defaultTarget() : resolveTarget(which) ?? defaultTarget();
    return proxy(req, res, target);
  }

  const url = new URL(req.url, 'http://localhost');
  // normalize evita que un .. salga de dist.
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, rel);

  if (await serveFile(res, filePath)) return;

  // Sin extensión: es una ruta de página, se sirve su index.html.
  if (!extname(rel)) {
    const asIndex = join(filePath, 'index.html');
    if (await serveFile(res, asIndex)) return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404\n');
});

server.listen(port, host, () => {
  const addrs = host === '0.0.0.0' || host === '::' ? ['127.0.0.1', ...lanIPv4s()] : [host];
  console.log(`sirviendo ${root}`);
  for (const a of addrs) {
    console.log(`  http://${a}:${port}/`);
    console.log(`  http://${a}:${port}/connect`);
  }
  console.log(`  /rpc -> ${NODES.length} nodo(s):`);
  NODES.forEach((n, i) => {
    const label = n.name ?? String(i);
    console.log(`    [${label}] ${n.url}${label === DEFAULT_NODE ? '   (por defecto)' : ''}`);
  });
  console.log(
    envFiles.length
      ? `  config desde: ${envFiles.join(', ')}`
      : '  config desde: variables de entorno (no hay .env)',
  );
});

/** Las IPs de las interfaces de esta maquina, para anunciar donde entra el
 *  panel cuando escucha en todas. No son las de los nodos: es donde sirve este
 *  mismo sitio. */
function lanIPv4s() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal && !out.includes(i.address)) out.push(i.address);
    }
  }
  return out;
}
