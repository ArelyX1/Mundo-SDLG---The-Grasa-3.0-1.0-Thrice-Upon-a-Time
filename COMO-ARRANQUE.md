# Cómo arrancar la red

Guía para levantar el nodo JAM (`strawberry`), comprobar que funciona y apagarlo.
Todo lo que sigue está verificado ejecutándolo en este repositorio; los comandos
y las rutas son los que hay, no los que deberían ser.

## Dónde está cada cosa

| Qué | Ruta |
| --- | --- |
| Nodo Go | `node-go/` |
| Binario compilado | `node-go/strawberry` |
| Config del nodo | `node-go/appconfig.json` |
| Validadores de la red dev | `node-go/test_validators.json` |
| Genesis de la economía PAPU | `node-go/genesis/chain-dev.json` |
| Script de comprobación de humo | `node-go/scripts/devnet-smoke.sh` |
| Runtime de la cadena | `node-go/pkg/devnet/runtime.go` |
| Productor de bloques | `node-go/cmd/strawberry/producer.go` |
| Servidor RPC | `node-go/cmd/strawberry/rpc.go` |
| Constantes de la cadena dev | `node-go/internal/constants/chain_dev.go` |

`node-go` es un submódulo del repositorio padre. El resto (`node-ts`,
`blockchain`, `tools`, `references`) no participa en esto.

## Requisitos

- Go (probado con 1.25).
- Rust y Cargo, para las dos librerías nativas: `bandersnatch` (firmas de
  validadores) y `erasurecoding` (Reed-Solomon). Sin ellas el nodo no enlaza.
- `curl`, para las comprobaciones.

## 1. Compilar

Las librerías nativas primero, y luego el nodo:

```bash
cd node-go
make build-bandersnatch
make build-erasurecoding
go build -tags dev -o strawberry ./cmd/strawberry/
```

El tag `dev` es lo que activa la cadena de desarrollo: 2 validadores y timeslots
de 6 segundos, en vez de los valores de producción. Sin él se compila la cadena
real, que es lo que hace `make build` (esa cible no lleva el tag).

Comprobado: las dos librerías nativas compilan y quedan en
`internal/crypto/bandersnatch/lib/libbandersnatch.so` e
`internal/erasurecoding/reedsolomon/lib/liberasurecoding.so`. La segunda se llama
`liberasurecoding`, no `libreedsolomon`.

## 2. Comprobar que arranca

Este es el paso que verifica que todo funciona. Levanta un nodo, espera a que
responda el RPC, confirma que la cadena produce bloques encadenados y lo apaga:

```bash
cd node-go
./scripts/devnet-smoke.sh
```

Salida esperada:

```
==> arrancando nodo en el puerto 19944 (log: /tmp/strawberry-smoke.log)
    RPC responde
    último bloque: 0x06e330fd...
    último bloque: 0x919f9f51...
    stateRoot avanzando (2 raíces distintas en los últimos bloques)

OK: el nodo arranca, sirve RPC y produce bloques encadenados
nodo apagado
```

Sale con 0 si todo va bien. Falla, con 1, si el RPC no contesta en 60s, si no hay
ningún bloque, o si la cadena no avanza entre dos consultas.

Variantes:

```bash
RPC_PORT=19955 ./scripts/devnet-smoke.sh       # otro puerto
KEEP_RUNNING=1 ./scripts/devnet-smoke.sh       # lo deja vivo al terminar
DATA_DIR=/tmp/strawberry-data ./scripts/devnet-smoke.sh   # estado en disco
```

## 3. Encender el nodo y dejarlo corriendo

```bash
cd node-go
./strawberry --name MiNodo --rpc-port 9944 --data-dir ""
```

Con `--data-dir ""` el estado vive en memoria y se pierde al apagar, que es lo
que se quiere para una prueba. Para conservarlo:

```bash
./strawberry --name MiNodo --rpc-port 9944 --data-dir /tmp/strawberry-data
```

Verás bloques produciéndose en la salida, uno cada 6 segundos:

```
| INFO | message: "block produced" | "number": "6" | "slot": "9177087" | "stateRoot": "0xb7c8c9..."
```

## 4. Hablar con el nodo

RPC sobre HTTP y WebSocket en `ws://127.0.0.1:9944` y `http://127.0.0.1:9944`.

```bash
# ¿está sano?
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' \
  http://127.0.0.1:9944/
# {"jsonrpc":"2.0","id":1,"result":{"isSyncing":false,"peers":0,"shouldHavePeers":false}}

# último bloque
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"chain_getBlockHash","params":[99999999]}' \
  http://127.0.0.1:9944/

# PAPU: oferta total (sin parámetros)
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"papucoin_supply","params":[]}' \
  http://127.0.0.1:9944/
# {"jsonrpc":"2.0","id":1,"result":{"decimals":12,"maxSupply":"1000000000",...}}

# PAPU: saldo de una cuenta (sí necesita la dirección como parámetro)
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"papucoin_balance","params":["0x0000...00"]}' \
  http://127.0.0.1:9944/
```

`system_chain` devuelve `Strawberry dev` y `system_version` devuelve
`0.1.0-dev`. `rpc_methods` lista todo lo disponible, que es la forma rápida de
descubrir qué consulta la versión que tengas delante.

Otros métodos: `system_name`, `system_peers`, `chain_getHeader`, `chain_getBlock`,
`chain_getFinalizedHead`, `chain_subscribeNewHeads`, `state_getMetadata`,
`papucoin_submit`, `papucoin_faucet`.

## 5. Apagar

```bash
pkill -f strawberry
```

O, si lolevant con `KEEP_RUNNING=1`, el PID queda impreso y se para con
`kill <pid>`.

## Cómo funciona el proceso

Al arrancar, en este orden (`cmd/strawberry/main.go`):

1. Lee `appconfig.json` para el nivel de log y el índice de validador.
2. Carga `test_validators.json`, que tiene los 2 validadores de la cadena dev.
3. Carga `genesis/chain-dev.json`, que define la moneda PAPU: símbolo,_decimals,
   oferta máxima, comisión de transferencia y cantidades del grifo.
4. Abre la base de datos. Vacío = en memoria.
5. Construye el runtime de `pkg/devnet`, que es quien posee el estado: servicios,
   saldos PAPU y raíz de estado.
6. Crea el nodo P2P y lo arranca.
7. Levanta el RPC, antes que el productor de bloques, para que las suscripciones
   estén listas antes de que exista el primer bloque.
8. Arranca el productor de bloques y entra en `select {}`, o sea que se queda
   vivo indefinidamente.

El estado no se guarda en el runtime: se reconstruye reproduciendo los bloques.
Es lo que garantiza que el estado con el que reanuda un nodo sea el que
describen sus propios bloques.

## Comprobaciones más a fondo

El script de humo solo demuestra que el nodo arranca y avanza. Para el resto:

```bash
make test              # suite completa: PVM, estado, store, SDK
make test-sdk          # el SDK es otro módulo; ./... solo no lo cubre
./pkg/devnet/          # runtime: 19 tests de bloques, Transfers, grifo, raíz de estado
```

Salvedades conocidas, en `node-go/docs/PVM-CONFORMANCE.md`:

- `TestTraceFuzzy` (205 casos) no se ejecuta: satura la máquina. Los primeros
  lotes pasan con `-parallel 2`.
- `TestTraceFuzzy` sin terminar no significa que falle; significa que no se ha
  comprobado.

## Problemas frecuentes

**`ld returned 1: No space left on device` al compilar.** La caché de build de Go
se hincha mucho con las suites largas. Se libera con `go clean -cache`, y
devuelve varios GB.

**El nodo no enlaza.** Faltan las librerías nativas. `make build-bandersnatch` y
`make build-erasurecoding`, y comprobar que quedaron en
`internal/crypto/bandersnatch/lib/` y `internal/erasurecoding/reedsolomon/lib/`.
La segunda se llama `liberasurecoding`, no `libreedsolomon`.

**`address already in use`.** Otro nodo en ese puerto. `RPC_PORT=...` para el
script, `--rpc-port` para el binario.

**`genesis load failed`.** El path de `--genesis` es relativo al directorio de
trabajo, así que hay que arrancar desde `node-go/` o pasar una ruta absoluta.
