#!/usr/bin/env bash
# Crea el Secret `sdlg-wallets` a partir de los archivos locales blockchain/wallets/.
# Ejecutar desde K8S/blockchain/sdlg-jam/ (o pasar la ruta de wallets como $1).
# Uso:
#   ./02-wallets-secret.sh            # usa ../../../blockchain/wallets
#   ./02-wallets-secret.sh /ruta/wallets
set -euo pipefail

NAMESPACE="${NAMESPACE:-2023241041}"
WALLETS_DIR="${1:-../../../blockchain/wallets}"

if [ ! -d "$WALLETS_DIR" ]; then
  echo "Error: no existe $WALLETS_DIR" >&2
  exit 1
fi

grep -l '"name": "validator-\|"name": "bridge"\|"name": "issuer"' "$WALLETS_DIR"/*.json >/dev/null 2>&1 || {
  echo "Error: no se encontraron wallets esperadas (validator-*, bridge, issuer) en $WALLETS_DIR" >&2
  exit 1
}

kubectl -n "$NAMESPACE" create secret generic sdlg-wallets \
  --from-file="$WALLETS_DIR" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Secret sdlg-wallets creado. Claves incluidas:"
kubectl -n "$NAMESPACE" get secret sdlg-wallets -o jsonpath='{.data}' | tr ',' '\n' | sed 's/[:}].*/: <redactado>/'