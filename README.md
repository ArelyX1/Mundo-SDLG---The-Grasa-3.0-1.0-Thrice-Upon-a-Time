# Mundo SDLG

Red JAM propia. Este repo es la **cumbre**: por debajo viven los módulos del
proyecto, cada uno con su historia y su ciclo de vida.

## Mapa

| Ruta | Módulo | Qué es |
| --- | --- | --- |
| [`node-go/`](node-go) | Nodo JAM en Go | Fork de [`eigerco/strawberry`](https://github.com/eigerco/strawberry) (Gray Paper v0.7.2). Nodo completo: Safrole, PVM, cores, erasure coding. Incluye el **SDK de services** en `node-go/sdk/`. |
| [`node-ts/`](node-ts) | Nodo JAM en TypeScript | Nodo ligero, paquete npm `sdlg-jam`. Modelo de servicios del Gray Paper sin Substrate. Incluye la **gateway `eth_*` para MetaMask**. |
| [`deploy/k8s/`](deploy/k8s) | Despliegue | Manifiestos e infraestructura de Kubernetes para `node-ts` en un clúster. |
| [`references/`](references) | Referencias | Repos de terceros clonados solo para consulta. No se versionan. Ver su [README](references/README.md). |

## Los dos nodos

`node-go` y `node-ts` son **dos implementaciones del mismo protocolo**, no un
legacy y su reemplazo. `node-go` es el camino a un nodo completo; `node-ts` es
el que se despliega hoy y el que expone la gateway de MetaMask. Comparten la
especificación, no el código: la lógica de servicios está escrita dos veces
(una en TypeScript, otra en Go dentro del SDK) porque el Gray Paper no define
un lenguaje, y portar la lógica a los dos es parte del trabajo.

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

Vive en los dos nodos:

- `node-ts/src/services/papucoin/` — implementación de referencia.
- `node-go/sdk/papucoin/` — implementación nativa, con tests de vectores
  firmados externamente para no validar el signer contra sí mismo.

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
