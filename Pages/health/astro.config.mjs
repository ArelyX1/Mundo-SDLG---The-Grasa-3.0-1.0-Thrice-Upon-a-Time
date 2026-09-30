import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// El nodo no envía cabeceras CORS, así que el navegador no puede llamarlo
// directamente desde otra origen. Este proxy hace de puente en desarrollo y en
// la preview, que es donde se usa esta página.
//
// En producción hay que poner delante algo equivalente: nginx, Caddy o el
// propio servidor que aloje la red, reenviando /rpc al 9944 del nodo.
const target = process.env.RPC_TARGET ?? 'http://127.0.0.1:9944';

export default defineConfig({
  integrations: [react()],
  server: {
    port: 4321,
    proxy: {
      '/rpc': {
        target,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc/, ''),
      },
    },
  },
});
