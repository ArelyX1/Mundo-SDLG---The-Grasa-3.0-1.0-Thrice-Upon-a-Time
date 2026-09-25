#!/usr/bin/env bash
# Deploy SDLG-JAM sin necesitar permisos sobre Secrets (modo RBAC minimo).
# Unica necesidad apoyada en Resources que cualquier SA namespace-scoped suele tener:
#   configmaps, deployments, persistentvolumeclaims, services, pods (logs/get).
# Las wallets se montan via ConfigMap (NO Secret) por eso: ver README "Modo RBAC minimo".
# PASO 1 (automatico): regenera genesis-k8s.json + ConfigMap con epochStart al futuro
#   (evita el deadlock de bootstrap en frio: ver make-genesis-k8s.sh).
# OJO: re-ejecutar en una cadena ya existente regenera genesis -> conviene borrar PVCs
#   (kubectl -n $NS delete pvc data-validator-{0,1,2,3}) para arrancar limpio.
# Uso: ./deploy-rbac-min.sh <dir-wallets> [namespace]
set -euo pipefail

WALLETS_DIR="${1:?uso: $0 <dir-con-las-wallets-json> [namespace]}"
NS="${2:-2023241041}"
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$WALLETS_DIR" ]; then echo "no existe el dir de wallets: $WALLETS_DIR"; exit 1; fi

echo "==> [1/7] genesis k8s regenerado con epochStart al futuro (evita deadlock de bootstrap)"
GEN_SRC="${GEN_SRC:-$DIR/../../../blockchain/genesis/genesis.json}"
"$DIR/make-genesis-k8s.sh" "$GEN_SRC" 90000 "$NS"

echo "==> [2/7] namespace (si no existe)"
kubectl apply -f "$DIR/00-namespace.yaml" --request-timeout=20s || \
  echo "  (namespace existe / sin permiso de crearlo: NO es bloqueante)"

echo "==> [3/7] genesis (ConfigMap)"
kubectl apply -f "$DIR/01-genesis-configmap.yaml" --validate=false --request-timeout=20s

echo "==> [4/7] wallets (ConfigMap desde $WALLETS_DIR)"
kubectl create configmap sdlg-wallets --from-file="$WALLETS_DIR" \
  --dry-run=client -o yaml -n "$NS" | kubectl apply -f - --validate=false --request-timeout=20s

echo "==> [5/7] PVC + deployments"
kubectl apply -f "$DIR/05-pvc.yaml" --validate=false --request-timeout=20s
kubectl apply -f "$DIR/03-validator-0.yaml" --validate=false --request-timeout=20s
kubectl apply -f "$DIR/03-validators-1-3.yaml" --validate=false --request-timeout=20s

echo "==> [6/7] Service interno"
kubectl apply -f "$DIR/04-services.yaml" --validate=false --request-timeout=20s

echo "==> [7/7] esperando rollout (sin loops: un solo wait de 90s)"
kubectl rollout status deploy/validator-0 --timeout=90s -n "$NS" || true
kubectl rollout status deploy/validator-1 --timeout=90s -n "$NS" || true
kubectl rollout status deploy/validator-2 --timeout=90s -n "$NS" || true
kubectl rollout status deploy/validator-3 --timeout=90s -n "$NS" || true

echo
echo "Estado actual:"
kubectl get deploy,pods,pvc,svc -n "$NS" -l app=sdlg-jam
echo
echo "OK. Para validar consenso/head:"
echo "  kubectl -n $NS logs deploy/validator-0 --tail=20"