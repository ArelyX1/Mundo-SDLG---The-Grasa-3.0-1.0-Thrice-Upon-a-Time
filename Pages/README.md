# Pages

Dos páginas Astro con islas de React, sobre la red que corre en `node-go`.

| Carpeta | Qué es | Ruta |
| --- | --- | --- |
| `health/` | Panel de salud de la red: estado, bloques, economía, almacenamiento, disponibilidad, registros y gráficos. | `/` |
| `connect/` | Conexión de la wallet y consulta de saldo PAPU. | `/connect` |

Ambas leen del RPC del nodo. No hay ni un dato de ejemplo: cada número que sale
en pantalla salió de una llamada real, y cuando el nodo está apagado el panel lo
dice en vez de rellenar huecos.

## Requisito previo: el nodo tiene que estar encendido

Las páginas no tienen datos propios. Con el nodo apagado, el panel muestra estado
apagado y la página de conectar avisa de que no hay nada que leer.

```bash
cd ../node-go
./strawberry --name Local --rpc-port 9944 --data-dir ""
```

## Instalar

Una vez por proyecto:

```bash
cd health && npm install && cd ..
cd connect && npm install && cd ..
```

## Arrancar en desarrollo

Dos terminales, o dos procesos:

```bash
cd health  && npm run dev     # http://127.0.0.1:4321
cd connect && npm run dev     # http://127.0.0.1:4322
```

## Construir y servir

Para producción. `serve.mjs` es un servidor sin dependencias que sirve `dist/` y
además hace de proxy a `/rpc`, porque el nodo no manda cabeceras CORS y el
navegador no puede llamarlo directamente.

```bash
cd health  && npm run build && npm run serve   # puerto 4321
cd connect && npm run build && PORT=4322 npm run serve
```

Variables que ambos leen:

- `PORT` puerto donde escuchar, 4321 por defecto.
- `RPC_TARGET` nodo al que reenviar `/rpc`, `http://127.0.0.1:9944` por defecto.

## Comprobar que funciona

```bash
# el nodo responde
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}' \
  http://127.0.0.1:9944/

# el proxy devuelve lo mismo que el nodo
curl -s -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"papucoin_supply","params":[]}' \
  http://127.0.0.1:4321/rpc
```

Si el nodo está apagado, el proxy responde 503 con un JSON-RPC de error, que es
lo que el panel interpreta como "apagado".

## Qué muestra cada una

### Salud

Estado encendido/arrancando/apagado, tiempo en pantalla, disponibilidad de
sondeos, altura de bloque, peers, latencia del RPC, oferta y máximo PAPU,
entradas y bytes de almacenamiento, slots y epochs, cola pendiente, extrinsics,
raíces de estado y el registro de lo que el panel ha ido viendo.

Gráficos: línea de latencia, área de altura de bloque, área de oferta con la
línea del máximo, barras y línea combinadas para almacenamiento, radar del perfil
del nodo, dona de la cola, dispersión de latencia por bloque, barras apiladas de
disponibilidad, línea doble de slots y epochs, barras horizontales de métricas y
sparklines de tendencia.

### Conectar

Pide la cuenta a MetaMask, lee el saldo PAPU de esa dirección por RPC, y muestra
la identidad de la cadena. Comprueba si la wallet está en la misma red que
declara el nodo y avisa si no.

Un límite que conviene tener presente: el nodo expone `eth_chainId`,
`eth_blockNumber` y `eth_getBalance`, pero no atiende
`ethereum_requestAccounts`. La wallet entrega la dirección y a partir de ahí todo
se lee por RPC, así que hoy conectar es de verdad solo lectura. Está escrito en la
propia página en lugar de disimularlo. Para firmar transacciones habrá que
conectar los métodos correspondientes en `node-go/cmd/strawberry/rpc.go`.

## Gráficos

Recharts. Se eligió por tres cosas: es declarativo sobre JSX, renderiza en SVG
—que encaja con islas de React hydrateadas en Astro— y cubre de sobra los tipos
de gráfico que hacen falta aquí.

## Estructura

```
Pages/
├── health/
│   ├── serve.mjs              servidor + proxy /rpc
│   └── src/
│       ├── components/        HealthPanel, Charts, Ui
│       ├── lib/               rpc.ts (llamadas y formateo), useNetworkProbe.ts, types.ts
│       ├── pages/index.astro
│       └── styles/global.css
└── connect/
    ├── serve.mjs
    └── src/
        ├── components/        ConnectPage, Ui
        ├── lib/               wallet.ts (MetaMask y RPC), types.ts
        ├── pages/connect.astro
        └── styles/global.css
```

La paleta y la hoja de estilos están replicadas en los dos proyectos a propósito:
son páginas independientes y así cada una se despliega por su lado.
