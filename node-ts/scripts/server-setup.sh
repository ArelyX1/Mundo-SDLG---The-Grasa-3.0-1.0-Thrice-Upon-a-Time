#!/usr/bin/env bash
# Despliegue en un servidor autohosteado (VPS) con Docker Compose.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [1/4] Compilando el nodo =="
npm ci && npm run build

echo "==> [2/4] Generando genesis y wallets de la red =="
if [ ! -f genesis/genesis.json ]; then
  npm run dev -- init --validators 4 --users 5 --out ./genesis \
    --seed ws://validator-0:30334
else
  echo "genesis existente: usa el actual"
fi

echo "==> [3/4] Iniciando la red (siempre activa) =="
docker compose -f docker-compose.prod.yml up -d --build

echo "==> [4/4] Estado =="
docker compose -f docker-compose.prod.yml ps

cat <<'EOF'

RED SDLG-JAM EN SERVIDOR:
  RPC (loopback)   http://127.0.0.1:9944
  API (loopback)   http://127.0.0.1:8080

Para exponerlo al exterior con HTTPS, ponga un reverse proxy delante, p.ej.:

  # Caddyfile
  sdlg.midominio.com {
      reverse_proxy 127.0.0.1:8080   # economia API
  }
  rpc.sdlg.midominio.com {
      reverse_proxy 127.0.0.1:9944   # json-rpc
  }

  sudo systemctl enable --now caddy

Guarde una COPIA SEGURA de wallets/ en un lugar aparte (llave del issuer incluida).
Loguee como admin para emitir: npm run dev -- console  ->  mint issuer <addr> <monto>
EOF