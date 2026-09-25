#!/usr/bin/env bash
# Red local SDLG-JAM con Docker: genera genesis (si falta) y levanta 4 validadores.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f genesis/genesis.json ]; then
  echo "==> Generando genesis y wallets (red local, 4 validadores) =="
  npm run dev -- init --validators 4 --users 3 --out ./genesis \
    --seed ws://validator-0:30334
fi

echo "==> Construyendo y levantando la red =="
docker compose up --build -d

echo
echo "Red levantada:"
echo "  RPC      http://127.0.0.1:9944      (JSON-RPC)"
echo "  API      http://127.0.0.1:8080      (economia PAPUCOIN/SDLG)"
echo "  Consola  npm run dev -- console"
echo "  Logs     docker compose logs -f validator-0"

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
if [ -n "$IP" ]; then
  echo "  (Servidor: sustituya 127.0.0.1 por $IP o el dominio del VPS)"
fi