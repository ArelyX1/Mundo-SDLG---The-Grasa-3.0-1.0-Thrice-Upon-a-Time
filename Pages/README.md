# Pages

Web de la red, un solo sitio: `/` es el panel de salud y `/connect` la conexión
de wallet. Un proyecto Astro con islas de React, no dos.

Todo lo que se ve sale del RPC del nodo. No hay ni un dato de ejemplo: cada
número que aparece en pantalla salió de una llamada real, y cuando el nodo está
apagado el panel lo dice en vez de rellenar huecos.

## Requisito previo: el nodo tiene que estar encendido

Las páginas no tienen datos propios. Con el nodo apagado, el panel muestra estado
apagado y la página de conectar avisa de que no hay nada que leer.

```bash
cd ../node-go
./strawberry --name Local --rpc-port 9944 --data-dir ""
```

## Instalar

```bash
npm install
```

## Arrancar en desarrollo

```bash
npm run dev      # http://127.0.0.1:4321
```

## Construir y servir

```bash
npm run build
npm run serve    # http://127.0.0.1:4321
```

`serve.mjs` es un servidor sin dependencias que sirve `dist/` y además hace de
proxy a `/rpc`, porque el nodo no manda cabeceras CORS y el navegador no puede
llamarlo desde otro origen.

Las tres formas de arrancar se comportan igual: `astro dev` lleva un plugin que
reenvia `/rpc`, y `serve.mjs` lo hace para `dist`. Antes el proxy solo existia
en `serve.mjs`, asi que `npm run dev` servia las paginas y todas las llamadas al
nodo daban 404 sin explicacion.

Variables que lee:

- `PORT` puerto donde escuchar, 4321 por defecto.
- `RPC_TARGET` nodo al que reenviar `/rpc`, `http://127.0.0.1:9944` por defecto.
- `SERVE_DIR` directorio que se sirve, `dist` por defecto.
- `NODE_ENV` modo, `development` por defecto.

## Configuracion

Se copia el ejemplo y se ajusta:

```bash
cp .env.example .env
```

`serve.mjs` lee los archivos en este orden, y **gana el ultimo**:

```
.env  ->  .env.local  ->  .env.<NODE_ENV>  ->  .env.<NODE_ENV>.local
```

Lo que venga del entorno real gana sobre todos los archivos, asi que en
produccion se pasa todo por variables sin tocar el `.env`. Al arrancar el
servidor dice de donde saco la configuracion:

```
sirviendo /ruta/Pages/dist
  http://127.0.0.1:4321/
  http://127.0.0.1:4321/connect
  /rpc -> http://10.0.0.5:9944
  config desde: .env, .env.local
```

`.env.example` esta en el repo; `.env` y los `.local` no, porque pueden llevar
direcciones de nodos privados.

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

Si el nodo está apagado el proxy responde 503 con un JSON-RPC de error, que es
lo que el panel lee como "apagado".

## Rutas

| Ruta | Qué es |
| --- | --- |
| `/` | Panel de salud. |
| `/connect` | Conexión de wallet y saldo PAPU. |

El nav es el mismo en las dos, con un enlace a la otra.

### Salud

Estado encendido/arrancando/apagado, tiempo encendido, disponibilidad de
sondeos, altura de bloque, peers, latencia del RPC, oferta y máximo PAPU,
entradas y bytes de almacenamiento, slots y epochs, cola pendiente, extrinsics,
raíces de estado y el registro de lo que el panel ha ido viendo.

Gráficos: línea de latencia, área de altura de bloque, área de oferta con la
línea del máximo, barras y línea combinadas para almacenamiento, radar del perfil
del nodo, dona de la cola, dispersión de latencia por bloque, barras apiladas de
disponibilidad, línea doble de slots y epochs, barras horizontales de métricas y
sparklines de tendencia.

Dos detalles que costaron encontrar, por si vuelven a salir:

- **El estado "arrancando" exige haber visto el nodo antes.** Una pagina
  recargada contra un nodo apagado no esta viendo nada arrancar, asi que dice
  apagado desde el primer instante.
- **La latencia solo se mide si el RPC respondió.** Medir cuánto tardó una
  conexión en fallar no es una latencia, y con el nodo apagado el gráfico se
  llenaba de tiempos de fallo como si fueran de servicio.
- **Los dominios de los ejes arrancan en cero.** Con el automático de Recharts y
  una serie que no se mueve, el eje se ajusta al único valor y la barra ocupa
  todo el alto, que se lee como si estuviera clavada arriba.

### Conectar

Pide la cuenta a MetaMask, lee el saldo PAPU de esa dirección por RPC y muestra
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
├── serve.mjs              servidor estatico + proxy /rpc
└── src/
    ├── components/        HealthPanel, ConnectPage, Charts, Ui
    ├── lib/               rpc.ts, wallet.ts, useNetworkProbe.ts, types.ts
    ├── pages/             index.astro, connect.astro
    └── styles/global.css
```
