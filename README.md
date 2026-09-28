# Mundo SDLG

Red JAM propia. Este repo es la **cumbre**: por debajo viven los módulos del
proyecto, cada uno con su historia y su ciclo de vida.

## Mapa

| Ruta | Módulo | Qué es |
| --- | --- | --- |
| [`node-go/`](node-go) | Nodo JAM en Go | Fork de [`eigerco/strawberry`](https://github.com/eigerco/strawberry) (Gray Paper v0.7.2). Nodo completo: Safrole, PVM, cores, erasure coding. Incluye el **SDK de services** en `node-go/sdk/`. |
| [`node-ts/`](node-ts) | Nodo JAM en TypeScript | Nodo ligero, paquete npm `sdlg-jam`. Modelo de servicios del Gray Paper sin Substrate. Incluye la **gateway `eth_*` para MetaMask**. |
| [`deploy/k8s/`](deploy/k8s) | Despliegue | Manifiestos e infraestructura de Kubernetes para `node-ts` en un clúster. |
| [`references/`](references) | Referencias | Repos de terceros solo para consulta. Ver su [README](references/README.md). |

## Replicar en otra máquina

`node-go` y `references/*` son **submódulos**: la raíz no guarda su código,
guarda el commit exacto al que apunta cada uno. Por eso clonar la raíz sin
`--recurse-submodules` te deja sin nodo de Go.

```sh
git clone --recurse-submodules https://github.com/ArelyX1/Mundo-SDLG---The-Grasa-3.0-1.0-Thrice-Upon-a-Time.git
cd Mundo-SDLG---The-Grasa-3.0-1.0-Thrice-Upon-a-Time
./scripts/bootstrap.sh
./scripts/verify.sh
```

`bootstrap.sh` deja la máquina lista: sincroniza el workspace de Go, instala
las dependencias de npm y fija `GOTMPDIR`, que el linker de Go necesita
apuntar al disco real porque el tmpfs de `/tmp` no aguanta un build pesado.
`verify.sh` comprueba que nada falte y sale con `1` si algo se rompió; sirve
también en CI.

Para actualizar un submódulo hay que commitear **dos** veces, primero dentro
del submódulo y luego en la raíz para mover el puntero:

```sh
cd node-go && git commit ... && git push
cd .. && git add node-go && git commit -m "bump node-go"
```

Las referencias no hacen falta para levantar la red, solo para consultarlas, y
son ~100 MB. `bootstrap.sh` las omite salvo que pidas `--with-references`.

## Quién es la cadena

Hay **una sola cadena**, y vive en `node-go`. `node-ts` es una puerta: expone
la superficie que MetaMask espera y reenvía cada pregunta al nodo por JSON-RPC.
No tiene claves privadas, no guarda bloques, no firma items y no tiene opinión
sobre un saldo. Ese es el motivo de que sea una puerta y no un nodo: un saldo
que se contesta desde dos sitios es un saldo que algún día se contradice.

```bash
# 1. la cadena
cd node-go && go run -tags dev ./cmd/strawberry \
  --data-dir ./data --rpc-port 9944 \
  --bridge-wallet 01...01 --validator 0@127.0.0.1:30334

# 2. la puerta que habla con MetaMask
cd node-ts && npm run dev -- gateway --upstream http://127.0.0.1:9944 --evm 8545
```

`npm run smoke` levanta las dos y comprueba el recorrido entero: la cadena
produce bloques, el faucet paga a una dirección `0x`, y una transacción firmada
por una clave que el nodo nunca vio mueve ese mismo saldo. `scripts/verify.sh`
comprueba lo mismo sin servidor a la vista (`VERIFY_CHAIN=0` se salta la parte
que tarda).

`node-ts` conserva un `start` con su propia cadena de laboratorio para familiarizarse
con el protocolo, y no es lo que se despliega: el genesis, la economía y el
estado que importan son los de `node-go/genesis/chain-dev.json`, generado con
`tools/genesis-from-ts.mjs`.

**No copies lógica de un nodo al otro.** Lo que debe coincidir son los
primitivos del protocolo: identificadores de service, claves de estado,
hashes, unidades de wei y de coretime. Esos son críticos de consenso y
cualquier divergencia entre implementaciones rompe la red.

## Módulos de Go dentro de `node-go`

`node-go` es un workspace de dos módulos:

- **nodo** (`node-go/go.mod`, módulo `github.com/eigerco/strawberry`) — el binario.
- **SDK** (`node-go/sdk/go.mod`, módulo `github.com/eigerco/strawberry/sdk`) —
  biblioteca para escribir services. Se puede consumir y testear sola, con
  `replace` al padre mientras no exista un tag que coincida con el checkout.

```bash
cd node-go
go test ./... ./sdk/...   # ambos módulos
make test-sdk             # solo el SDK
```

El SDK es **backend nativo de desarrollo, no consenso**: falta el
compilador/blob PVM que lo convierta en un service ejecutable de verdad. La
diferencia de gas y tiempos entre correrlo nativo y correrlo en PVM es
deliberadamente enorme, para que nadie confunda un benchmark de desarrollo con
una medida de la red.

## Servicios

`CRYPTOPAPU` (ticker **PAPU**) es la economía de la red: 12 decimales,
suministro máximo 1.000.000.000 PAPU, faucet de bienvenida y un relay EVM que
rechaza transacciones firmadas con `s` alto y siempre debita la dirección
recuperada de la firma, nunca la declarada.

La cadena la corre `node-go/sdk/papucoin/`, con tests contra vectores firmados
por una implementación independiente (`tools/evm-vectors`) para no validar el
signer contra sí mismo. `node-ts/src/services/papucoin/` se conserva como
referencia histórica y ya no participa de la cadena.

### Cómo se mueve un saldo desde MetaMask

Una billetera como MetaMask solo tiene una clave secp256k1, y el item nativo de
la cadena va firmado con Ed25519. El puente entre las dos es la transacción
cruda: lleva su propia firma, el servicio la recupera y toma **remitente,
destino, monto y nonce de los bytes firmados**, no de lo que el item dice. Por
eso una transacción no puede convertirse en un traslado desde una cuenta que el
firmante no controla, y por eso el proceso de la puerta no necesita ninguna
clave. El nonce de la cuenta lo lleva la cadena; el de la transacción lo lleva
la billetera.

Lo que la cadena todavía no hace, y la puerta lo dice en vez de disimularlo:

- **`eth_call` no tiene respuesta honesta.** No hay PVM, así que no hay contratos
  que ejecutar; no hay token ERC-20 que importar y `eth_getCode` responde
  `0x`.
- **`eth_getTransactionReceipt` responde `null`.** Los bloques llevan root y
  timeslot, no una lista de transacciones, así que no hay índice por hash. El
  saldo es la prueba.

## Configuración de compilación

El disco del entorno de desarrollo tiene el tmpfs de `/tmp` limitado, que es
donde el linker de Go escribe su salida por defecto. `GOTMPDIR` está fijado al
disco real para evitar `no space left on device` en builds pesados:

```bash
go env -w GOTMPDIR=$HOME/.cache/go-tmp
```

## Licencia

Ver [LICENSE](LICENSE). Las piezas heredadas de `eigerco/strawberry` conservan
sus licencias originales: el resto del fork es MIT y
`pkg/serialization/codec/jam/` es LGPL-3.0.
