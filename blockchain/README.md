# SDLG-JAM

Red **blockchain JAM** (Join-Accumulate Machine, modelo del *Gray Paper* de Polkadot) autohosteada, escrita en TypeScript, **sin Substrate**. Incluye el servicio de economía **CRYPTOPAPU** con ticker **PAPU** (máximo **1.000.000.000 PAPU**, 12 decimales).

> Nota de alcance: nada de "JAM completo" corre hoy (Safrole + PVM + 300 cores sigue en implementación por la comunidad; ver `docs/INVESTIGACION.md`). Este repo es un nodo ligero **fiel al modelo de servicios del Gray Paper** — work packages/items/results, `refine()` → `accumulate()` → `on_transfer()`, cores y timeslots — listo para levantar *ya* como red propia, local o en servidor.

## Arranque rápido (local)

```bash
npm install
npm run build

# 1) genera genesis + wallets (llaves de validadores, usuarios y el emisor)
node dist/cli/main.js init --validators 4 --users 3 --out ./genesis

# 2) arranca un validador (consola/API/RPC incluidos)
node dist/cli/main.js start --node validator-0

# 3) en otra terminal: consola de economia
node dist/cli/main.js console
```

Con Docker (red completa de 4 validadores en un comando):

```bash
./scripts/local-demo.sh
```

## Uso (economía CRYPTOPAPU / PAPU)

Consola interactiva: `node dist/cli/main.js console`

```
sdlg> info
sdlg> supply
sdlg> balance <direccion>
sdlg> transfer bridge <direccion> 1000 hola
sdlg> mint issuer <direccion> 250000      # solo el emisor
sdlg> burn bridge 10
sdlg> faucet bridge                      # grifo de prueba
```

API REST de economía (nodo `validator-0` en `http://127.0.0.1:8080`):

```bash
# info del token
curl http://127.0.0.1:8080/economy/info

# saldo
curl -X POST http://127.0.0.1:8080/economy/balance -H 'content-type: application/json' \
  -d '{"address":"sdlg2RQ..."}'

# transferir (la wallet vive en wallets/, privada en el servidor)
curl -X POST http://127.0.0.1:8080/economy/transfer -H 'content-type: application/json' \
  -d '{"wallet":"bridge","to":"sdlg2RQ...","amount":"1000","memo":"hola"}'

curl -X POST http://127.0.0.1:8080/economy/mint    -H 'content-type: application/json' -d '{"wallet":"issuer","to":"sdlg...","amount":"250000"}'
curl -X POST http://127.0.0.1:8080/economy/burn    -H 'content-type: application/json' -d '{"wallet":"bridge","amount":"10"}'
curl -X POST http://127.0.0.1:8080/economy/faucet  -H 'content-type: application/json' -d '{"wallet":"bridge"}'
curl http://127.0.0.1:8080/economy/events?n=20
curl http://127.0.0.1:8080/health
```

JSON-RPC (`http://127.0.0.1:9944`): `system_health`, `chain_getBlock`, `chain_getStateRoot`,
`papucoin_getBalance`, `papucoin_getNonce`, `papucoin_getConfig`, `papucoin_getSupply`,
`papucoin_getEvents`, `jam_getValidators`, `jam_getServices`, `jam_submitWork`.

## Puente EVM (MetaMask)

Cada validador expone un RPC estilo Ethereum en `http://127.0.0.1:8545+` (`JAM_EVM_PORT`, por defecto 8545) que permite a MetaMask operar PAPU sin instalar nada. El puente es **custodial por validación**: el nodo relaya las txs con la wallet `bridge` (`wallets/bridge.json`, se crea sola al primer arranque); la firma ECDSA (secp256k1) de la transacción Ethereum se verifica on-chain antes de acreditar.

Configuración en MetaMask → "Agregar red":

| campo | valor |
|---|---|
| Network name | `Mundo SDLG` |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `5120` (`0x1400`) |
| Símbolo | `PAPU` |
| Decimales | `12` (la capa EVM usa 18 decimales: `balance wei = saldo PAPU × 10⁶`) |

> El chain ID `5120` **no está registrado** en chainlist/ethereum-lists-chains (el registro
> que MetaMask usa para sus avisos). Los comúnes sí lo están — `512` = "Double-A Chain"
> (AAC), `1337` = "Geth Testnet" (ETH) — y por eso avisaban aunque el nombre fuera
> `Mundo SDLG`. Con `Mundo SDLG` + `5120` + `PAPU` no debería haber advertencias
> de nombre/símbolo al agregar la red.

### Agregar la red con el logo (recomendado)

El formulario manual de MetaMask no permite subir icono, y MetaMask **ignora `iconUrls` en `http://`**
(EIP-3085 exige HTTPS). Por eso el nodo sirve una mini-página de conexión que pasa el logo de la red
(`media/sdlg.webp` → `media/Mundo-SDLG-256.png`, publicado en
`https://files.catbox.moe/x6tiah.png`):

1. Abre `http://127.0.0.1:8545/evm/connect` en Chrome/Edge con MetaMask activo.
2. Click en **Agregar red y conectar (5 PAPU de bienvenida)** → MetaMask muestra el prompt
   con el logo y los datos. Una vez conectada, la cuenta activa recibe automáticamente
   **5 PAPU de bienvenida** (una sola vez por wallet, aunque se desconecte y reconecte).

La fuente de los iconos se cambia con `JAM_EVM_ICON_URL` (red) y `JAM_EVM_TOKEN_IMAGE_URL`
(token, ver `.env.example`). El nodo también sirve una copia local en
`http://127.0.0.1:8545/evm/icon.png` (útil como preview, no para `iconUrls`).

> Limitación de MetaMask: el logo de la red aparece en la ventana de confirmación de
> "Agregar red" y en esta página, pero el selector de redes y el balance superior muestran
> el avatar con la inicial ("M") para **toda** red custom no soportada; MetaMask solo embebe
> logos reales de las redes que lista como "soportadas". No es configurable desde el nodo.

Carga inicial: `POST /evm/faucet {"address":"0x..."}` (10.000 PAPU, una vez por dirección).

```bash
curl -X POST http://127.0.0.1:8545/evm/faucet -H 'content-type: application/json' -d '{"address":"0x..."}'
curl http://127.0.0.1:8545/evm/info
curl -s http://127.0.0.1:8545 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

Métodos soportados: `eth_chainId`, `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionCount`,
`eth_gasPrice`, `eth_estimateGas`, `eth_call`, `eth_getBlockByNumber/ByHash`, `eth_feeHistory`,
`eth_maxPriorityFeePerGas`, `eth_sendRawTransaction` (legacy, EIP-2930 y EIP-1559),
`eth_getTransactionByHash/Receipt`, `web3_*`, `net_*`.

Cada tx quema `transferFee` (1 micro-PAPU) como gas y el monto debe ser múltiplo de 1 micro-PAPU
(`1e6 wei`). Prueba end-to-end: `npx tsx scripts/evm-live.ts`.

## Red local vs servidor

| | local | servidor (VPS) |
|---|---|---|
| comando | `./scripts/local-demo.sh` | `./scripts/server-setup.sh` |
| compose | `docker-compose.yml` | `docker-compose.prod.yml` |
| puertos | p2p 30334+, rpc 9944, api 8080 | solo loopback + reverse proxy |
| docs | `README.md` | `docs/SERVIDOR.md` |

Detalles de arquitectura y mapeo al Gray Paper: `docs/ARQUITECTURA.md`.
Por qué no se integra un cliente JAM existente y el camino de upgrade: `docs/INVESTIGACION.md`.

## CLI

```
jam-node init    genera genesis + wallets            node dist/cli/main.js init --validators 4 --users 3 --out ./genesis
jam-node start   arranca un nodo                    node dist/cli/main.js start --node validator-0 --port 30334
jam-node keygen  llave suelta                        node dist/cli/main.js keygen --name user-9 --out ./wallets
jam-node wallets lista wallets                        node dist/cli/main.js wallets
jam-node console consola de economia                 node dist/cli/main.js console
```

> `init` **se niega a sobrescribir** un genesis existente salvo que pases `--force` (regenerar
> cambia las llaves de validadores y rompe una red corriendo). `init --help` solo muestra ayuda.

Config por entorno: ver `.env.example` (`JAM_NETWORK`, `JAM_NODE_NAME`, `JAM_GENESIS`,
`JAM_WALLET_DIR`, `JAM_P2P_PORT`, `JAM_RPC_PORT`, `JAM_API_PORT`, `JAM_SEED_PEERS`,
`JAM_LISTEN_ALL`, `JAM_TIMESLOT_SECS`).

## Tests

```bash
npm test          # unitarios (crypto, merkle, economia)
npm run smoke     # e2e: 4 validadores reales en P2P + mint + transfer + faucet
npx tsx scripts/synctest.ts                       # observador: sincroniza y sigue en vivo a ws://127.0.0.1:30334
npx tsx scripts/synctest.ts validator-1           # validador atrasado (usa wallets/validator-1.json) para probar recovery
```

## Seguridad

- `wallets/` contiene llaves privadas (incluida la del emisor). **Respaldo y restringe acceso.**
- En servidor exponga solo RPC/API por loopback y use un reverse proxy con TLS.
- La firma usa ed25519; las direcciones son `sdlg` + clave pública base58 con checksum.
- Fees quemados (deflacion de PAPU). Mint limitado al emisor y al max supply.

## Estructura

```
src/
├── core/         crypto (ed25519/blake), base58, merkle, tipos
├── chain/        estado, bloques, almacenamiento (JSONL+snapshots)
├── consensus/    autoridad (poa ligera, placeholder de Safrole)
├── jam/          work packages, pipeline refine->accumulate
├── services/     registro de servicios + CRYPTOPAPU (PAPU)
├── networking/   gossip p2p (WebSocket)
├── rpc/          JSON-RPC
├── api/          API REST economia
└── cli/          CLI (init/start/keygen/wallets/console)
```