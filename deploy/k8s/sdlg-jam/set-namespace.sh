#!/usr/bin/env bash
# Reescribe el namespace en todos los manifests y scripts (ademas del FQDN interno
# del seed: ws://sdlg-jam-validator-0.<NS>.svc.cluster.local).
#
# Uso: ./set-namespace.sh <nuevo-namespace>
set -euo pipefail
NS="${1:?uso: $0 <nuevo-namespace>}"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ "$NS" = "2023241041" ]; then
  echo "NS = 2023241041 (por defecto): no hay cambios."
  exit 0
fi

for f in \
  00-namespace.yaml 01-genesis-configmap.yaml \
  03-validator-0.yaml 03-validators-1-3.yaml \
  04-services.yaml 05-pvc.yaml 06-tunnel-cloudflared.yaml \
  deploy-rbac-min.sh make-genesis-k8s.sh; do
  [ -f "$f" ] || { echo "  (falta $f, se omite)"; continue; }
  sed -i "s/2023241041/$NS/g" "$f"
done

echo "namespace -> $NS (y seed FQDN) en manifests + scripts."
echo "El genesis-k8s.json y su ConfigMap se regeneran con el NS nuevo al correr make-genesis-k8s.sh / deploy-rbac-min.sh."