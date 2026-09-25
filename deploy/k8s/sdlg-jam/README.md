# SDLG-JAM en Kubernetes

Despliegue de la red local de 4 validadores en un cluster Kubernetes (k3s/kind/minikube/GKE).

- **Namespace**: `2023241041` (impuesto por permisos del cluster).
- **Dominio público**: `cryptopapu.neravy.us` (Cloudflare tunnel) para MetaMask.
- **Imagen**: `arelyxl/sdlg-jam:0.1.0` (Docker Hub, `imagePullPolicy: Always`).

## Presupuesto de recursos (tope total: 1 GB de RAM)

Los `limits` de cada pod se reparten proporcionalmente a su rol, sumando **≤ 960 Mi**
(queda ~40 Mi de margen para overhead del kubelet/pause):

| pod | requests | limits | justificación |
|---|---|---|---|
| `validator-0..3` (×4) | cpu 100m, ram 96Mi | cpu 500m, ram **225Mi** | consenso + JSON-RPC + API + EVM RPC (los pesados) |
| `sdlg-cloudflared` | cpu 10m, ram 24Mi | cpu 100m, ram **60Mi** | solo proxeja TLS → servicio |

Totales: `4 × 225 + 60 = 960 Mi` de límite; `4 × 96 + 24 = 408 Mi` de reserva.

Cómo re-tunear (los valores están en los `resources:` de cada manifest):
1. Elegí un tope total `T` Mi y pesos por pod `w_i` (larga para validators, chica para el tunnel).
2. `limits_mem_i = floor(w_i / Σw_i × T)`, ajustá redondeo y verifica que `Σ limits ≤ T`.
3. Si un pod va a crecer (estado de cadena), sube su peso y baja el del tunnel.

> Ojo: el estado de la cadena crece con los bloques; 225Mi por validador es cómodo para
> miles de bloques pero no escala infinito — si la cadena se hace grande, subí el tope total
> o persiste/hace pruning.

## Requisitos (server destino)

- Linux con `kubectl` apuntando al cluster y un SA con permisos **namespace-scoped**:
  `configmaps`, `deployments`, `persistentvolumeclaims`, `services`, `pods` (get/logs).
  Cuanto más permisos tengas( (admin completo) mejor; el modo RBAC mínimo cubre el peor caso.
- `node >= 20` en la máquina donde corrés el deploy (solo para regenerar el genesis).
- Acceso a internet para bajar `arelyxl/sdlg-jam:0.1.0` de Docker Hub. Si el cluster es
  offline, importala a mano: `docker pull arelyxl/sdlg-jam:0.1.0` y
  `ctr -n k8s.io images import` (o `k3d image import`).
- Las **wallets** (`node-ts/wallets/*.json`) NO están en git: copiás la carpeta desde el
  server original a la máquina desde donde hacés el deploy.

## Estructura de archivos

| archivo | qué hace |
|---|---|
| `00-namespace.yaml` | Namespace (si tu SA no puede crearlo, no es bloqueante) |
| `01-genesis-configmap.yaml` | Genesis como ConfigMap (lo regenera `make-genesis-k8s.sh`) |
| `02-wallets-secret.sh` | Modo admin: wallets como Secret |
| `03-validator-0.yaml` | Deployment del validador 0 (seed público del peering) |
| `03-validators-1-3.yaml` | Deployments 1-3 (conectan saliente al seed) |
| `04-services.yaml` | Service interno ClusterIP (FQDN para peering + punto único para el tunnel) |
| `05-pvc.yaml` | 4 PersistentVolumeClaims (`local-path`, 1Gi c/u) |
| `06-tunnel-cloudflared.yaml` | cloudflared -> `cryptopapu.neravy.us` (requiere Secret `cf-tunnel`) |
| `deploy-rbac-min.sh` | Deploy completo sin secrets (regenera genesis + wallets-configmap + apply) |
| `make-genesis-k8s.sh` | Regenera `genesis-k8s.json` + ConfigMap con `epochStart` al futuro |
| `set-namespace.sh` | Reescribe el namespace en todos los manifests/scripts + FQDN del seed |
| `genesis-k8s.json` | Genesis k8s generado (fuente de `01-genesis-configmap.yaml`) |

## Recipe para un server nuevo

### A) Red nueva desde cero (verificada en `epis-k3s`)

```bash
cd deploy/k8s/sdlg-jam

# 1) (opcional) si el namespace del nuevo cluster es distinto:
./set-namespace.sh mi-namespace          # reescribe manifests y scripts

# 2) deploy completo (regenera genesis, wallets-configmap, PVCs, 4 deployments, service):
./deploy-rbac-min.sh /ruta/completa/node-ts/wallets mí-namespace
#    si usaste set-namespace.sh ya no hace falta pasar el namespace:
./deploy-rbac-min.sh /ruta/completa/node-ts/wallets

# 3) verificar (sin exec, usa logs):
for v in 0 1 2 3; do kubectl -n mi-namespace logs deploy/validator-$v --tail=30 \
  | grep -oE 'state=[0-9a-f]+' | tail -1; done
# los 4 deben imprimir el MISMO stateRoot, y los logs deben mostrar "bloque #N autor=validator-X"
```

> Una red nueva NO hereda saldos/bloques del server original: arranca desde genesis con
> las mismas wallets, mismos saldos iniciales del genesis, y un `epochStart` nuevo.

### B) Misma red (continuidad) o nodo adicional de una red ya desplegada

- **Nodo adicional de una red ya viva** (leertor/validador externo): NO regeneres genesis.
  Copiá el `genesis-k8s.json` del server 1 como `genesis-k8s.json` acá, aplicá
  `01-genesis-configmap.yaml` tal cual, y apuntá `JAM_SEED_PEERS` al endpoint público del
  server 1 (tunnel, `ws://...:30334`). El `epochStart` debe ser EXACTO (sin regenerar).
- **Continuar la cadena del server 1**: además de wallets + genesis, copiá el `data/` de
  cada nodo (los PVC `local-path` del server 1) a los PVC de acá ANTES de levantar, para
  arrancar con head > 0. Si arrancan sin data, es un arranque en frío (cae en el deadlock).
- **Ojo**: no mezcles nodos viejos con nuevos validators sin data → misma regla del deadlock.

## Orden de despliegue

### Modo RBAC mínimo (NO requiere permisos sobre Secrets) — VERIFICADO y funcionando

Si vuestro ServiceAccount solo puede con recursos del namespace (configmaps, deployments,
pvc, services, pods/logs) pero **no get/create secrets** (es el caso en el cluster `epis-k3s`,
SA `system:serviceaccount:2023241041:2023241041`), usá el script:

```bash
cd deploy/k8s/sdlg-jam
./deploy-rbac-min.sh ../../../node-ts/wallets 2023241041
```

El script:
1. Regenera el genesis k8s con `epochStart` **al futuro** (ver `make-genesis-k8s.sh`).
2. Aplica `00-namespace.yaml` (si no hay permiso, no es bloqueante).
3. Aplica el genesis ConfigMap.
4. Crea `sdlg-wallets` como **ConfigMap** (monta `node-ts/wallets/*.json`).
5. Aplica PVC + los 4 deployments (imagen `arelyxl/sdlg-jam:0.1.0` desde Docker Hub).
6. Crea el Service interno.
7. Espera el rollout y muestra estado.

> ⚠️ **Caveat de seguridad**: en este modo las claves privadas viajan en un **ConfigMap**
> (legible por cualquiera con `get configmaps` en el namespace) en vez de un Secret.
> Para produccion seria mejor que un admin corra el [modo Secret](#modo-admin-secret-recomendado)
> o rote las claves. Permite arrancar la red sin esperar al admin.

> 🔁 Re-ejecutar sobre una cadena existente regenera el genesis: borrá los PVC antes
> (`kubectl -n $NS delete pvc data-validator-{0,1,2,3}`) para arrancar desde cero.

### Bootstrap en frío (deadlock de slot 0) — causa raíz y fix

**Síntoma**: los pods arrancan OK pero la cadena no avanza y el log repite sin parar:
`posponemos autorar (slot N): head=0/lejos, solicitamos resync`, o quedan todos
sincronizados en un head viejo congelado.

**Causa**: si el nodo nace con `head=0` cuando el slot actual ya pasó (genesis con
`epochStart` en el pasado, o "now" y los pods tardan en levantar), la consola posterior
la autoría hasta no completar las slots faltantes — que a su vez solo podrían generarlas
los otros validadores, que están en el mismo estado → **ningún gen produjo las primeras
slots → la cadena tiene brechas → deadlock de bootstrap**.

**Fix (aplicado y verificado)**: generar el genesis para k8s con `epochStart` **~90s en el
futuro** (`./make-genesis-k8s.sh [genesis] [buffer-ms]`). Así los 4 pods bootean, se
conectan por peering y quedan Ready ANTES del slot 0 → slot 1 en adelante se autoriza y
sincroniza sin brechas. Verificado: 4/4 validadores autorando contiguo (#1..#14+),
mismo `stateRoot=872346c6…` en los 4, sin WARNs de postergación.

### Modo admin (Secret — recomendado)

```bash
cd deploy/k8s/sdlg-jam

# 0) genesis k8s con epochStart al futuro (evita el deadlock de bootstrap, ver arriba)
./make-genesis-k8s.sh

# 1) namespace + genesis
kubectl apply -f 00-namespace.yaml
kubectl apply -f 01-genesis-configmap.yaml

# 2) wallets como Secret (lee node-ts/wallets/*.json, NO los commitea)
./02-wallets-secret.sh ../../../node-ts/wallets

# 3) almacenamiento + validators
kubectl apply -f 05-pvc.yaml          # ajusta storageClassName segun tu cluster
kubectl apply -f 03-validator-0.yaml
kubectl apply -f 03-validators-1-3.yaml

# 4) service interno (DNS para peering + punto unico para el tunnel)
kubectl apply -f 04-services.yaml

# 5) tunnel -> cryptopapu.neravy.us (ver el encabezado de 06-tunnel-cloudflared.yaml)
kubectl -n 2023241041 create secret generic cf-tunnel --from-literal=token=<TOKEN>
kubectl apply -f 06-tunnel-cloudflared.yaml
```

El **tunnel** (ver encabezado de `06-tunnel-cloudflared.yaml`) se corre como **servicio en el
host** con el token propio del tunnel `e2d6e3c9-...` (`sudo cloudflared service install <TOKEN>`
+ config `/etc/cloudflared/config.yml` apuntando a `http://172.16.10.31:32545`). No usa ningún
Secret/ConfigMap del cluster ni comparte token con otros tunnels (cada tunnel sirve sus propios
hostnames). En servers sin ese host disponible, existe la alternativa en-cluster (Deployment del
mismo archivo).

### Acceso SIN tunnel: NodePort en la IP del nodo (verificado)

`04-services.yaml` además define `sdlg-jam-nodeport` (type NodePort). Todos los paths del
cluster que puedan llegar al nodo usan su IP (ej: `172.16.10.31`):

| endpoint | URL |
|---|---|
| EVM RPC (MetaMask/web3) | `http://172.16.10.31:32545` |
| JSON-RPC (CLI console) | `http://172.16.10.31:32244` |
| Economy API | `http://172.16.10.31:32080` |

```bash
curl -s -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  -H 'content-type: application/json' http://172.16.10.31:32545
# -> {"jsonrpc":"2.0","id":1,"result":"0x1400"}   (0x1400 = chainId 5120)
```

> `sdlg-jam-validator-0` y las IPs `10.42.x`/`10.43.x` son SOLO internos del cluster: no
> resuelven ni rutean desde afuera. Para salir a internet queda el tunnel (HTTPS), que
> MetaMask necesita (NodePort es HTTP y MetaMask exige https salvo localhost).

Verificar:

```bash
kubectl -n 2023241041 get pods -o wide
kubectl -n 2023241041 logs deploy/validator-0 --tail=50

# consenso: los 4 deben dar el mismo head y stateRoot
kubectl -n 2023241041 exec deploy/validator-0 -- sh -c \
  'wget -qO- --post-data="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"system_health\"}" \
   --header="content-type: application/json" http://127.0.0.1:9944'
```

Sin `exec` (RBAC mínimo): compará el `stateRoot` y el head por logs:

```bash
for v in 0 1 2 3; do kubectl -n 2023241041 logs deploy/validator-$v --tail=30 \
  | grep -oE '(bloque #[0-9]+ autor=validator-[0-9]|state=[0-9a-f]+)' | tail -2; done
```

Señales de red sana: cada validador autorrea SUS slots (`bloque #N autor=validator-X`),
los heads avanzan ~cada 6s, y el `stateRoot` es el mismo en los 4. Cualquier
`posponemos autorar ... solicitamos resync` repetido = deadlock de bootstrap
(ver sección correspondiente: regenerar genesis con `make-genesis-k8s.sh` y borrar PVCs).

## Imagen del contenedor

La imagen ya está publicada en Docker Hub: `arelyxl/sdlg-jam:0.1.0`. Los manifiestos usan
`imagePullPolicy: Always`, así que cualquier cluster con acceso a Docker Hub la baja automáticamente.

Para regenerarla y subir una versión nueva:

```bash
docker build -t sdlg-jam:0.1.0 .
docker tag sdlg-jam:0.1.0 arelyxl/sdlg-jam:<version>
docker push arelyxl/sdlg-jam:<version>
# y actualiza image: en los 03-*.yaml (4 lugares)
```

> La imagen arranca `dist/cli/main.js` y en el cluster recibe `args: ["start","--node",...]`
> + envs `JAM_*` + genesis/wallets montados desde ConfigMap/Secret (ver `03-*.yaml`).
> Tambien expone los puertos 30334 (P2P), 9944 (JSON-RPC local), 8080 (economy API) y
> 8545 (EVM RPC para MetaMask).

## Red / endpoint (tunnel vs IP publica vs nginx)

Hay dos tipos de trafico y cada uno se resuelve distinto. **NO hace falta IP publica.**

### 1) Clientes (MetaMask, CLI console, API) — tunnel

MetaMask (EVM RPC 8545), el CLI (`node dist/cli/main.js console`) y la API (8080) son
**conexiones salientes desde el cliente** al nodo. Un tunnel las expone sin IP publica:

- **Cloudflare (usado aquí)**: tunnel `e2d6e3c9-07d8-4987-b6d9-8e3a97e3ec18` + DNS
  `cryptopapu.neravy.us` -> EVM RPC 8545. TLS (https) lo termina Cloudflare.
- Para mas servicios: `rpc.cryptopapu.neravy.us -> :9944`, `api.cryptopapu.neravy.us -> :8080`
  (mismo tunnel, agregar ingress rules y CNAME).
- Alternativas: ngrok (`ngrok http 8545`), Tailscale Funnel, bore.

Requisito MetaMask: al agregar la red desde otro equipo el RPC debe ser **https**
(con el tunnel ya lo es): `https://cryptopapu.neravy.us`.

### 2) Peer-to-peer entre validadores (P2P 30334) — DNS interno del cluster

Los 4 validators corren en el **mismo cluster**: NO se exponen a internet.
Validator-1..3 conectan saliente a
`ws://sdlg-jam-validator-0.2023241041.svc.cluster.local:30334` (Service de `04-services.yaml`).
Es tráfico interno de k8s; no necesita puerto publico ni tunnel. Solo `validator-0` queda como
punto publico (a traves del tunnel) para clientes y futuros nodos externos.

Si algun validador corre en otra máquina sin IP publica, usa una **VPN/mesh (Tailscale)** entre
las maquinas y pon en `JAM_SEED_PEERS` la IP privada de overlay (`ws://100.x.x.x:30334`).

### 3) nginx reverse proxy — SI pero no obligatorio

nginx **no es necesario** con Cloudflare. Tiene sentido **solo si** tenes un VPS con IP publica
para `IP publica -> nginx/Ingress -> Service`. Con cloudflared el TLS lo maneja Cloudflare y
nginx sobra; solo lo usarias para enrutar varios hostnames por diversa razon.

**Resumen**: con tunnel alcanza. IP publica / nginx solo si queres conexiones directas por puertos
(validadores externos) o terminar TLS con tu propio nginx.

## MetaMask

| campo | valor |
|---|---|
| Network name | `Mundo SDLG` |
| RPC URL | `https://cryptopapu.neravy.us` |
| Chain ID | `5120` (`0x1400`) |
| Símbolo | `PAPU` |
| Decimales | `18` (capa EVM) |

## Notas

- La cadena en k8s arranca **desde genesis = cadena nueva** (data PVC limpio). No hereda el estado
  local de `node-ts/data/`.
- El genesis aun acredita saldos a `user-0/1/2` (direcciones sin clave). Si queres una red nueva
  sin esos saldos, regenera el genesis antes de subir el ConfigMap.
- Los 4 validators montan el MISMO Secret `sdlg-wallets` (como en docker-compose cada uno lee su
  wallet por nombre). No comitees `node-ts/wallets/*.json` si no esta en `.gitignore`.