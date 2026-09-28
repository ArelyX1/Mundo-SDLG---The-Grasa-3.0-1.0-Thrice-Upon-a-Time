#!/usr/bin/env bash
# Comprueba que esta copia tiene todo lo necesario para levantar la red, y que
# lo que falta no esta fallando en silencio.
#
# Pensado para correr en una maquina nueva justo despues de bootstrap.sh, y
# para correr en CI. Sale con 1 si algo no esta.
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD
FAIL=0

ok() { printf '  ok    %s\n' "$1"; }
bad() {
	printf '  FALLA %s\n' "$1"
	FAIL=1
}

printf '== Componentes versionados\n'
# Un submódulo no materializado se ve como un directorio vacio o ni existe.
for path in node-go references/dcrd references/polkavm references/ajanta; do
	if [ -f "$ROOT/.gitmodules" ] && grep -q "path = $path" "$ROOT/.gitmodules"; then
		if [ -e "$ROOT/$path/.git" ]; then
			ok "$path (submodulo en $(git -C "$ROOT/$path" rev-parse --short HEAD))"
		else
			bad "$path declarado en .gitmodules pero no materializado (git submodule update --init $path)"
		fi
	else
		bad "$path no esta declarado en .gitmodules"
	fi
done

# Un gitlink apunta a un commit. Si el submodulo esta en otro commit del que el
# gitlink registra, la maquina no reproduce lo que el repo dice reproducir.
check_pinned() {
	local path=$1 want have
	want=$(git ls-tree HEAD "$path" | awk '{print $3}')
	have=$(git -C "$ROOT/$path" rev-parse HEAD 2>/dev/null)
	if [ "$want" = "$have" ]; then
		ok "$path fijado en ${want:0:7}"
	else
		bad "$path en ${have:0:7} pero el gitlink dice ${want:0:7}"
	fi
}
if git rev-parse --verify HEAD >/dev/null 2>&1; then
	for path in node-go references/dcrd references/polkavm references/ajanta; do
		[ -e "$ROOT/$path/.git" ] && check_pinned "$path"
	done
fi

printf '\n== Codigo del proyecto\n'
for f in README.md LICENSE node-ts/package.json node-go/go.work node-go/sdk/go.mod \
	deploy/k8s/sdlg-jam/00-namespace.yaml tools/evm-vectors/gen.mjs; do
	[ -f "$ROOT/$f" ] && ok "$f" || bad "falta $f"
done

printf '\n== Economia PAPU\n'
# Si el SDK no compila, la red no tiene economia.
if [ -d "$ROOT/node-go/sdk/papucoin" ]; then
	for f in service.go evmtx.go rlp.go; do
		[ -f "$ROOT/node-go/sdk/papucoin/$f" ] && ok "sdk/papucoin/$f" || bad "falta sdk/papucoin/$f"
	done
else
	bad "no hay SDK: la economia PAPU vive en node-go/sdk"
fi

printf '\n==.Toolchain\n'
command -v go >/dev/null && ok "go $(go version | cut -d' ' -f3)" || bad "falta go"
command -v node >/dev/null && ok "node $(node --version)" || bad "falta node"

printf '\n== Build\n'
if command -v go >/dev/null && [ -d "$ROOT/node-go" ]; then
	(cd "$ROOT/node-go" && go build ./... ./sdk/...) >/dev/null 2>&1 &&
		ok "go build (nodo + SDK)" ||
		bad "go build fallo (mira GOTMPDIR: el linker escribe ahi y un tmpfs pequeno lo corta)"
fi

printf '\n== Tests\n'
# Los tests del runtime y del comando son los que comprueban que la cadena hace
# algo: que un bloque se construye sobre el estado que el nodo dice tener, y que un
# nodo reiniciado continua la cadena que estaba corriendo.
if command -v go >/dev/null && [ -d "$ROOT/node-go" ]; then
	if (cd "$ROOT/node-go" && go test -count=1 -tags dev ./pkg/devnet/ ./sdk/... >/dev/null 2>&1); then
		ok "go test (runtime PAPU + SDK)"
	else
		bad "go test fallo (mira GOTMPDIR: el linker escribe ahi y un tmpfs pequeno lo corta)"
	fi
	if [ "${VERIFY_CHAIN:-1}" = "1" ]; then
		# Estos levantan un nodo de verdad y esperan sus timeslots, asi que tardan
		# mas que el resto. VERIFY_CHAIN=0 los salta cuando se quiere solo el
		# chequeo estatico.
		if (cd "$ROOT/node-go" && go test -count=1 -tags dev -timeout 10m ./cmd/strawberry/ >/dev/null 2>&1); then
			ok "go test (nodo: cadena, state root, reinicio)"
		else
			bad "go test fallo en el comando del nodo"
		fi
	fi
fi

printf '\n== Espacio\n'
avail=$(df -BG --output=avail "$ROOT" | tail -1 | tr -dc '0-9')
if [ "${avail:-0}" -ge 5 ]; then
	ok "${avail} GB libres"
else
	bad "solo ${avail:-0} GB libres; el checkout de node-go con sus vectores de conformidad necesita mucho mas"
fi

printf '\n'
if [ "$FAIL" -eq 0 ]; then
	echo "Todo en su sitio."
else
	echo "Hay problemas arriba. ./scripts/bootstrap.sh deberia resolverlos."
fi
exit "$FAIL"
