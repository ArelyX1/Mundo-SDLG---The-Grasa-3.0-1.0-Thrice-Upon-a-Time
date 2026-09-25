#!/usr/bin/env bash
# Regenera genesis-k8s.json (mismas claves y saldos que node-ts/genesis/genesis.json)
# pero con epochStart fresco apuntando al FUTURO.
#
# Por que al futuro: si los pods nacen con head=0 cuando el slot ya arranco (epochStart
# en el pasado o "ahora"), la consola de cada validador POSTERGA autorrar ("posponemos
# autorar: head=0, solicitamos resync") y nunca se cierran las primeras slots -> brecha
# de bloques -> deadlock de bootstrap. Con epochStart = now + BUFFER los pods tienen
# tiempo de levantar y hacer peering ANTES del slot 0.
#
# Uso: ./make-genesis-k8s.sh [genesis-origen] [buffer-ms] [namespace]
#   default genesis: ../../../node-ts/genesis/genesis.json (relativo al repo)
#   default buffer : 90000 (90s)
#   default ns     : 2023241041
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${1:-$DIR/../../../node-ts/genesis/genesis.json}"
BUF_MS="${2:-90000}"
NS="${3:-2023241041}"

node - "$SRC" "$BUF_MS" "$DIR" "$NS" <<'EOF'
const [src, buf, dir, ns] = process.argv.slice(2);
const fs = require("fs");
const path = require("path");
const srcAbs = path.resolve(process.cwd(), src);
const g = JSON.parse(fs.readFileSync(srcAbs, "utf8"));
g.epochStart = Date.now() + Number(buf);
g.createdAt = new Date().toISOString();
fs.writeFileSync(`${dir}/genesis-k8s.json`, JSON.stringify(g, null, 2) + "\n");
const body = JSON.stringify(g, null, 2).split("\n").map(l => "    " + l).join("\n");
const yaml = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: sdlg-genesis\n  namespace: \"" + ns + "\"\ndata:\n  genesis.json: |-\n" + body + "\n";
fs.writeFileSync(`${dir}/01-genesis-configmap.yaml`, yaml);
console.log(`genesis-k8s.json actualizado: epochStart=${g.epochStart} (+${buf}ms en el futuro) ns=${ns}`);
EOF