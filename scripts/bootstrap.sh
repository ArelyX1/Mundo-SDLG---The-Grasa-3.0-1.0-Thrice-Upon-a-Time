#!/usr/bin/env bash
# Materializa una copia completa de Mundo SDLG y comprueba que sirve para
# levantar la red.
#
#   git clone --recurse-submodules <url> && cd <repo> && ./scripts/bootstrap.sh
#
# El clon recursivo trae el nodo de Go, que es el unico componente del que la
# red depende de verdad. Las referencias se omiten a proposito: no se ejecutan
# y son ~100 MB. Pedilas con --with-references.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD

WANT_REFERENCES=0
for arg in "$@"; do
	case "$arg" in
	--with-references) WANT_REFERENCES=1 ;;
	-h | --help)
		sed -n '2,10p' "$0" | cut -c3-
		exit 0
		;;
	*)
		echo "opcion desconocida: $arg" >&2
		exit 2
		;;
	esac
done

step() { printf '\n== %s\n' "$1"; }

step "Componentes"
# node-go lleva la URL del fork en .gitmodules. Si alguien clonó sin
# --recurse-submodules, esto lo trae igual.
if [ ! -f node-go/go.work ]; then
	git submodule update --init node-go
fi
if [ "$WANT_REFERENCES" -eq 1 ]; then
	git submodule update --init references/
else
	echo "referencias omitidas (--with-references para traerlas)"
fi
git submodule status --recursive | sed 's/^/  /'

step "Herramientas"
command -v go >/dev/null || {
	echo "falta go: https://go.dev/dl/" >&2
	exit 1
}
command -v node >/dev/null || {
	echo "falta node: https://nodejs.org/" >&2
	exit 1
}
printf '  go    %s\n' "$(go version | cut -d' ' -f3)"
printf '  node  %s\n' "$(node --version)"

# El linker de Go escribe su salida en GOTMPDIR. En un tmpfs pequeno se queda
# sin espacio a mitad de un build pesado, que es un fallo dificil de leer.
if [ -z "${GOTMPDIR:-}" ]; then
	mkdir -p "$HOME/.cache/go-tmp"
	go env -w GOTMPDIR="$HOME/.cache/go-tmp"
fi
printf '  GOTMPDIR  %s\n' "$(go env GOTMPDIR)"

step "Dependencias de Go"
cd "$ROOT/node-go"
go work sync

step "Dependencias de node-ts"
cd "$ROOT/node-ts"
[ -d node_modules ] || npm ci

step "Listo"
echo "  Nodo Go   cd node-go   && go build ./... ./sdk/..."
echo "  Nodo TS   cd node-ts   && npm run build"
echo "  k8s       manifests en deploy/k8s/sdlg-jam/"
