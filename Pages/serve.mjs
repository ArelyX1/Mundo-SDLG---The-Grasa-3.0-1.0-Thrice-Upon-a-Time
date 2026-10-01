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
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const port = Number(process.env.PORT ?? 4321);
const rpcTarget = process.env.RPC_TARGET ?? 'http://127.0.0.1:9944';

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

async function proxy(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(rpcTarget, {
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
        error: { code: -32000, message: `nodo inaccesible en ${rpcTarget}: ${err.message}` },
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

const server = createServer(async (req, res) => {
  if (req.url === '/rpc') return proxy(req, res);

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

server.listen(port, '127.0.0.1', () => {
  console.log(`sirviendo ${root}`);
  console.log(`  http://127.0.0.1:${port}/`);
  console.log(`  http://127.0.0.1:${port}/connect`);
  console.log(`  /rpc -> ${rpcTarget}`);
  console.log(
    envFiles.length
      ? `  config desde: ${envFiles.join(', ')}`
      : '  config desde: variables de entorno (no hay .env)',
  );
});
