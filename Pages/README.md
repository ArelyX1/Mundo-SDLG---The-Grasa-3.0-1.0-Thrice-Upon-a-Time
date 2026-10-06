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
- `NODES` nodos que el sitio puede mirar, separados por comas. Sin esto, se barren
  los puertos de `SCAN_FROM` a `SCAN_TO`.
- `RPC_TARGET` nodo de reenvio cuando no hay `NODES`, `http://127.0.0.1:9944` por
  defecto. Si declaras `NODES`, esta variable manda solo sobre el primero.
- `SCAN_FROM`, `SCAN_TO` rango que se barre, `9944`-`9960` por defecto.
- `NODE_DEFAULT` nodo inicial por indice, `0` por defecto.
- `SERVE_DIR` directorio que se sirve, `dist` por defecto.
- `NODE_ENV` modo, `development` por defecto.

## Varios nodos

El sitio puede mirar mas de uno. Al abrirse los prueba todos y, si hay dos o mas
vivos, deja elegir cual mirar. Con uno solo no aparece selector: no hay nada que
elegir.

### La red se descubre sola, sin listar nadie

Basta con un nodo alcanzable (el "seed"). La pagina le pregunta por
`network_map` y eso le dice quien esta en la red: el nodo mismo (con su nombre,
version, indice de validador y puerto RPC) y sus peers, cada uno con su
direccion P2P. Con eso el panel construye la lista y sondea a cada uno.

No hay que mantener la lista de la red en la web: se anade un nodo, entra al
mesh, y el panel lo ve en el siguiente sondeo. Si un nodo cae y otro vuelve,
tambien se nota sin recargar la pagina.

Como la red anuncia a los peers por su direccion P2P y eso no dice cual es su
puerto RPC, el panel prueba candidatos en orden: el puerto RPC del seed, el
9944 por defecto, y la convencion del devnet (RPC = P2P - 21390, que es lo que
hace que 30334.. correspondan a 9944..). El primero que responda gana. Si la red
usa puertos RPC propios, se lista cada nodo en `NODES` y la pagina lo usa tal
cual, sin probar puertos.

La red tolera que cualquier validador caiga. Con `--skip-missing-authors` el
suplente escribe el turno del autor muerto y la cadena sigue avanzando. Cuando
el nodo vuelve, se pone al dia solo. El panel muestra esa realidad:

- **Validadores vivos**: X de Y responden. Si alguno falta, se ve tachado en el
  selector, no se oculta.
- **Cadena**: avanza aunque falten validadores. Si los nodos vivos estan de
  acuerdo en la altura, lo dice; si no, tambien.
- **Autor del ultimo bloque**: con skip, el suplente puede ser el autor de un
  turno que no le correspondia.
- **Tolerancia**: la red aguanta hasta N-1 caidos, siendo N el numero de
  validadores.
- **Registro**: el panel anota caidas y recuperaciones en el registro, sin
  recargar. "nodo X se cayo · la cadena sigue con los demas validadores" y
  "nodo X volvio a la red · altura N".

El sondeo de todos los nodos se repite cada 8 segundos ademas del sondeo
principal de 2 segundos al nodo elegido. Los cambios de estado se anotan una
vez; lo que no cambia no genera ruido.

Como declararlos:

```bash
# en el .env: un solo seed, el resto se descubre solo
NODES=http://192.168.1.10:9944
```

O no declarar nada y arrancar dos nodos: el sitio barre los puertos de localhost
del rango y los encuentra solo.

El nodo elegido se recuerda en el navegador, asi que recargar no pierde la
eleccion. En `/connect`, si el nodo que estaba sirviendo datos se cae, la pagina
busca otro vivo automaticamente.

El sondeo va limitado a cuatro nodos a la vez a proposito. Todas las llamadas
salen por el proxy del sitio, o sea al mismo origen, y el navegador no deja mas
de seis conexiones por host: con dieciocho puertos por cinco llamadas cada uno,
las ultimas expiraban por el limite del navegador y los nodos vivos se perdian
por eso y no por estar apagados.

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

Estado encendido/arrancando/apagado, tiempo encendido, selector de nodo, disponibilidad de
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

El campo "sincronizando" sale de `isSyncing` de `system_health`. Es honesto
pero hoy no puede decir que si: el nodo lo devuelve fijo a `false` porque uno
dev que reproduce desde genesis de forma sincrona no tiene nada que sincronizar.
Sustituirlo por informacion real es trabajo de sincronizacion que el nodo todavia
no hace.

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
