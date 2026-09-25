# Despliegue en servidor autohosteado (VPS)

Guía para levantar la red **SDLG-JAM** con economía **PAPUCOIN (SDLG)** en un servidor propio.

## Requisitos

- VPS/Debian/Ubuntu, 2 vCPU / 2GB RAM mínimo (usa muy poco ahora, reserva margen).
- Docker + Docker Compose plugin: `sudo apt install docker.io docker-compose-v2`.
- Dominio (opcional pero recomendado) para exponer API/RPC con HTTPS.
- Git + Node.js 20+ en el host (solo para generar el genesis; el nodo corre en contenedor).

## Paso 1 — clonar y generar la red

```bash
cd /opt
git clone <TU-REPO> sdlg-jam && cd sdlg-jam/blockchain
npm ci && npm run build

# Genera genesis + wallets (4 validadores, 5 usuarios)
node dist/cli/main.js init --validators 4 --users 5 --out ./genesis \
  --seed ws://validator-0:30334
```

**Ahora mismo, respalde `wallets/`** (contiene `issuer.json`, la llave que emite PAPU):
```bash
tar czf /root/sdlg-wallets-backup.tgz wallets/   # guardelo FUERA del servidor
```

## Paso 2 — levantar la red

```bash
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml ps
```

Comprobación:
```bash
curl http://127.0.0.1:8080/health          # {"ok":true,...}
curl -X POST http://127.0.0.1:9944 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"papucoin_getSupply"}'
```

Los contenedores usan `restart: always`; la data persiste en `./data/`.

## Paso 3 — exponer con HTTPS (opcional)

La compose solo publica en **loopback** (`127.0.0.1`). Ponga un reverse proxy delante:

**Caddy** (instalar: `sudo apt install caddy`), en `/etc/caddy/Caddyfile`:
```
sdlg.midominio.com     { reverse_proxy 127.0.0.1:8080 }
rpc.sdlg.midominio.com { reverse_proxy 127.0.0.1:9944 }
```
```bash
sudo systemctl enable --now caddy
```
Caddy emitirá TLS automáticamente (apunte los registros DNS a la IP del VPS).

Alternativa nginx con certbot: proxy_pass a `127.0.0.1:8080` y `127.0.0.1:9944`.

## Administracion de la economía (desde el servidor)

```bash
npm run dev -- console
```
```
sdlg> info
sdlg> supply
sdlg> mint issuer <direccion> 250000     # emisión (solo issuer)
sdlg> transfer issuer <direccion> 1000
sdlg> events
```

## Operación

| comando | efecto |
|---|---|
| `docker compose -f docker-compose.prod.yml logs -f validator-0` | ver logs |
| `docker compose -f docker-compose.prod.yml restart validator-0` | reiniciar un nodo |
| `docker compose -f docker-compose.prod.yml up -d` | reactivar tras reboot |
| `docker volume ls` / `ls data/` | data persistida |

### Actualizar versión

```bash
git pull
sudo docker compose -f docker-compose.prod.yml up -d --build
```

## Conceptos de alta disponibilidad (para crecer)

- **Más validadores**: añadir nodos en un segundo VPS con la misma `genesis.json`, enlazando
  `JAM_SEED_PEERS` al primer servidor (`ws://IP-PUBLICA:30334` — hay que abrir el puerto p2p en el
  firewall y publicarlo en `docker-compose.prod.yml`).
- **Backups**: snapshots automáticos en `data/*/state.json` cada 48 slots; copie `data/` bajo
  custodia si necesita restaurar historia.
- **Rotación de emisor**: cambie `economy.issuer` solo creando una red nueva (el genesis define el
  emisor). Mantenga `issuer.json` bajo llave.

## Firewall

Docker abre los puertos publicados. En producción deje público únicamente:
- **80/443** (reverse proxy).
- **30334/tcp** SOLO si quiere que otros VPS validen desde fuera (p2p).

RPC/API (9944/8080) y el RPC EVM (8545+, `JAM_EVM_PORT`) que se mantengan en loopback. El puente
EVM es un relay del nodo: **no** lo exponga a internet sin auth (MetaMask local, usuario único).