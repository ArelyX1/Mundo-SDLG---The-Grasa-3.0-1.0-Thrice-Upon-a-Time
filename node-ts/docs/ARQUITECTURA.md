# Arquitectura SDLG-JAM

Implementación **influyida por el Gray Paper de JAM** (Join-Accumulate Machine), sin Substrate.
Este documento explica cómo cada pieza del código corresponde al modelo JAM y qué se dejó fuera.

## El ciclo JAM (refine → accumulate)

```
                ┌────────────────── fuera de cadena (cores) ──────────────────┐
usuarios/API ──> WorkItem(s) ──> WorkPackage (un core, un timeslot)            │
                                   │                                          │
                                   ▼ refine()  (por servicio, sin estado)      │
                          WorkReport (items + results)                        │
                                   │                                          │
                                   ▼  se firma dentro de un bloque ───────────┘
                ┌────────────────── en cadena (todos los validadores) ────────┐
                          accumulate() dobla los results al estado compartido │
                                   │                                          │
                                   ▼                                          │
                          stateRoot (Merkle determinista) ──> persistir + dif  │
                └─────────────────────────────────────────────────────────────┘
```

- **WorkItem**: entrada firmada (serviceId, método, params, sender, nonce). `src/jam/work-package.ts`.
- **WorkPackage/WorkReport**: un paquete usa **un core** por **un timeslot** (Gray Paper). Aquí: core 0 fijo, timeslots de 6 s por defecto.
- **refine()**: puro y determinista (verifica firma/estructura, normaliza la operación). Sin estado.
- **accumulate()**: aplica el efecto con validez de estado completa (saldo, nonce, supply) y muta el estado compartido.
- **on_transfer()**: punto de entrada para tokens/memo de otros servicios (reservado, acuerdos futuros).

La cadena de bloques solo contiene **reports** (el resultado de refine) + la firma del autor; el
“input” viaja en el report para que cualquier nodo pueda re-ejecutar y verificar.

## Servicios

Registro en `src/services/registry.ts`. En JAM un servicio es código desplegable con 3 puntos de
entrada; aquí los servicios son módulos del nodo (el despliegue dinámico de código en PVM es parte
del upgrade path, ver `INVESTIGACION.md`).

### CRYPTOPAPU (PAPU) — `src/services/papucoin/service.ts`

| campo | valor |
|---|---|
| nombre | CRYPTOPAPU |
| ticker | PAPU |
| decimals | 12 |
| **max supply** | **1.000.000.000 PAPU** (1e9 × 1e12 unidades atómicas) |
| fee transfer | 1 micro-PAPU (1e-6), **quemado** (deflación) |
| faucet | 10.000 PAPU por dirección, una vez |

Métodos (work items): `transfer`, `mint` (solo el emisor del genesis), `burn`, `faucet`.

Estado (`State`, mapa clave→valor con `stateRoot` de Merkle):
```
papucoin/config/{symbol,name,decimals,maxSupplyRaw,issuer}
papucoin/balance/<PAPU>/<addr>
papucoin/nonce/<addr>
papucoin/evmnonce/<addr>
papucoin/supply/<PAPU>
papucoin/faucet/<addr>
system/network, system/services
```

Seguridad: firma ed25519 (`verifyString`, prefijo de dominio `SDLG-JAM::1`), nonce antirreplay,
límites de emisión. Direcciones `sdlg1...` = base58(pubkey || blake4(checksum)).

## Puente EVM (`src/api/evm.ts`, `src/evm/evm.ts`)

Un RPC estilo Ethereum por validador (`JAM_EVM_PORT`, 8545+) que permite a MetaMask operar PAPU.
No es una EVM completa: es un **relay custodial**. Una tx Ethereum (legacy/EIP-2930/EIP-1559)
firmada con secp256k1 se parsea y se verifica la firma con `@noble/curves` (`keccak_256` de
`@noble/hashes`); el nodo la envuelve en un work item de `transfer` firmado por la wallet `bridge`
(`wallets/bridge.json`, autogenerada) con los campos `{ to, amount, from, evmNonce, raw }`.

- `refine()` del `transfer` re-deriva `from` desde la firma ECDSA y exige que coincida con `params.from`.
- `accumulate()` valida el nonce EVM (`papucoin/evmnonce/<0xaddr>`, **siguiente** nonce a usar,
  arranca en 0) y acredita tras descontar el fee.
- Escala: PAPU tiene 12 decimales; la capa EVM muestra 18 (`EVM_WEI_SCALE = 1e6`),
  `eth_getBalance = saldoRaw × 1e6`. Todo monto debe ser múltiplo de 1 micro-PAPU (`1e6 wei`).
- Fees = `transferFee` (gas `21000`, `eth_gasPrice`), quemados como cualquier transfer.
- Estados: red `Mundo SDLG`, `eth_chainId=5120` (`0x1400`, no registrado en chainlist;
  `512` lo usa "Double-A Chain" y `1337` "Geth Testnet") y `eth_blockNumber` = timeslot del head.
- `faucet` a direcciones `0x` vía `POST /evm/faucet`, reclamado una vez por dirección
  (mismo `papucoin/faucet/<addr>`).

## Consenso

`src/consensus/authority.ts`: **Autoridad por rotación** (PoA): el líder de un timeslot es
`validators[slot % N]`; firma el bloque; los demás re-ejecutan accumulate y exigen que el
`stateRoot` coincida (si no → disputa registrada y bloque descartado).

> JAM/Polkadot usa **Safrole** (basado en SSS, derivado de Sassafras) para finalidad. El módulo de
> autoridad es un reemplazo mínimo y determinista con la misma interfaz, pensado para cambiarse por
> Safrole sin tocar el resto (ver `INVESTIGACION.md`).

## Sincronización

- Gossip P2P por WebSocket (`src/networking/gossip.ts`). Nodos semilla en el genesis (`seedPeers`)
  **y** en `JAM_SEED_PEERS` (el CLI los pasa al boot; sin esto cada nodo queda aislado).
- Difusión: `block`, `work`, `sync-req`/`sync-resp` y anuncios de `head` (1 por timeslot) que dejan
  a los peers detectar fronteras.
- Importación estricta: solo se acepta un bloque si `parentHash === head.hash`; si llega un hueco,
  se pide resync. **El resync se ancla al head máximo declarado por peers** (`maxPeerSlot - 63..maxPeerSlot`),
  no a `head+1`, para soportar cadenas con huecos iniciales y uniones tardías.
- Anti-fork al autorar: un líder solo se abstiene si va atrasado **y** algún peer declara un head
  mayor (`maxPeerSlot > head`). Así un reinicio total de la red no congela la producción (nadie
  declara head mayor) y un solo nodo atrasado sí espera a su red.
- Catch-up continuo: cada 500 ms, si `head < slot - 1`, se vuelve a pedir la ventana de la frontera
  (deduplicada por bucket de 64) hasta ponerse al día; aplica también a observadores sin clave.
- Reorg por replay: `tryAdopt`/`adoptChain` re-ejecutan la rama más larga desde el ancestro común
  canónico y validan firma + `stateRoot` antes de adoptarla.
- Bloque slot 0 = genesis (sin firma, construido idéntico en todos los nodos).

## Persistencia

`src/chain/storage.ts`: bloques en `blocks.jsonl` + snapshot atómico de estado (`state.json`/) cada
48 slots y al apagar. Al arrancar se **reconstruye el estado re-ejecutando solo la cadena canónica**
desde genesis (`stateAtSigned`); el bloque genesis se inserta si falta. `commit` deduplica por hash.

## Topología de red

- Puertos por nodo: **p2p** ws (30334), **JSON-RPC** http (9944), **API economía** http (8080).
- Local: `docker-compose.yml` (4 validadores, puertos mapeados).
- Servidor: `docker-compose.prod.yml` (RPC/API solo loopback; reverse proxy con TLS delante).

## Límites conocidos (explícitos)

- Un solo core (configurable) y timeslots de 6 s por defecto — no hay coretime/agile coretime real.
- Sin PVM/RISC-V: refine corre en el nodo, no en una VM medible de gas.
- Sin gobernanza/upgrades on-chain; los validadores son estáticos en el genesis.
- La elección de fork es simple (cadena contigua más larga); sin mecanismo de disputas on-chain.
- idoneo para red propia/test; no reemplaza la certificación M1 del Fellowship.
- Dos cadenas de bloques vacíos (sin ops) con el mismo genesis tienen **raíces idénticas**: al
  verificar una red conviene mirar `peers` (debe ser > 0) además del `stateRoot`, para no confundir
  determinismo con consenso real.
- `epochStart` queda fijado en genesis; reiniciar meses después arranca en un slot alto (no es un bug).