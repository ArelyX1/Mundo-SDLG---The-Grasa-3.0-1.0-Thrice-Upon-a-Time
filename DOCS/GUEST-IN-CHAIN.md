# La economia PAPU corre como guest polkavm dentro de la cadena

## Estado

La economia de PAPU ya no es codigo Go: es un guest Rust que el PVM ejecuta, y
la cadena lo invoca por su propio camino. Verificado de punta a punta contra un
nodo real, no solo en tests.

## Como se llega a que la cadena lo use

El PVM resuelve del blob las dos cosas que el linker posee:

- **El punto de entrada.** `refine.go` y `accumulate.go` ya no pasan `0` y `5`
  hardcodeados; leen el offset del export. Los numeros transformedos que estaban
  en el codigo eran de la version vieja del layout y simplemente no existian en
  el blob actual.
- **Los indices de ecall.** El linker numera los imports por el orden en que el
  guest los llama por primera vez. Se traducen por nombre al id canonico del
  host, que es lo que el dispatcher ya sabe manejar.

`svc.Runtime` es la interfaz que ambos implementan, asi que un servicio puede
cambiar entre handlers Go y guest sin tocar la transicion de estado. La cuenta
de servicio y el seed del genesis son los mismos en los dos casos, que es lo que
hace comparables a ambos.

El genesis acepta ahora `service.code`, que apunta al blob. El runtime valida
que el guest sea ejecutable al arrancar, para fallar al inicio y no en el primer
work item.

## Verificacion de punta a punta

Nodo arrancado con el guest, item firmado por el bridge, consultado por RPC:

```
papucoin_faucet  -> accepted, amount 10000
papucoin_balance -> 10000 PAPU, raw 10000000000000000
papucoin_supply  -> 10000 PAPU, storageItems 4
```

`storageItems: 4` es la prueba de que las cuatro claves las escribio el guest
(supply, balance, faucet claim, nonce) y no el executor nativo.

Ademas, `TestGuestEconomyInTheChain` comprueba que el saldo que acredita el
guest es exactamente el mismo que acredita el servicio nativo, leyendo por la
misma vista que usa el RPC.

## El bug que cazo el test end to end

El guest acreditaba 10^19 en vez de 10^16 en el faucet: mil veces de mas. La
constante estaba mal en el guest y ningun test anterior lo habria visto, porque
comparaban el guest consigo mismo. Solo al compararlo contra `Params.FaucetAmount`
del nativo aparecio la diferencia.

Es el argumento para que el test de cadena compare contra el nativo y no contra
un valor escrito a mano.

## Firmas

`mustBeSigned` verifica Ed25519 en el guest contra el payload con dominio
`SDLG-PAPU::1`, y la direccion `sdlg` se valida con base58 + blake2b-256. Un item
con la firma manipulada se rechaza.

Detalle que custo tiempo: el JSON del item usa `mustBeSigned` en camelCase y
serde buscaba `must_be_signed`, asi que el campo nunca se parseaba, quedaba
`false`, y la verificacion entera se saltaba. **Una firma manipulada pasaba.**
Un test con un fixture malicioso lo revealo; sin el, el fallo de seguridad seria
silencioso.

Las direcciones `sdlg` conservan su mayuscula, porque base58 es sensible a ella.

## Stack

El linker declara 8 KiB de stack, insuficiente para ed25519. `MemoryConfig` del
blob aporta la cifra minima, y se usa un suelo mayor porque el linker no puede
inferir lo que necesita la aritmetica de curva.

## Lo que falta

- **Relay EVM**: un item con `raw` sigue devolviendo reporte vacio. Falta RLP y
  ecrecover en el guest, para que MetaMask pueda mover saldo.
- **`welcome` en la RPC**: el whitelist de `Submit` solo admite transfer, faucet
  y mint, igual que antes del port.
- **Firmado con clave `sdlg` en cadena**: hoy el nativo valida la firma en
  `Submit` y el guest la revalida al refinar. La doble validacion es correcta
  pero redundante.

## Correccion respecto a una afirmacion previa

En un resumen anterior dije que el profiler reordenaba los ecalls "alfabeticamente
por nombre de simbolo". Era falso: el orden es el de primera llamada en el codigo.
El sintoma fue un guest que llamaba a `fetch` y no escribia nada, en silencio.

## Comandos

```bash
cd /tmp/opencode/papu-guest-rs && cargo +nightly-2025-05-10 build --release
polkatool link -i revive_v1 -o guest.pol target/riscv64emac-unknown-none-polkavm/release/papu-guest-rs

# test de cadena: el guest contra el servicio nativo
BLOB=$PWD/guest.pol go test ./pkg/devnet -run TestGuestEconomyInTheChain -v -count=1

# nodo real con la economia como guest
go run ./cmd/strawberry -validator -genesis /ruta/genesis-con-code.json \
  -bridge-wallet $(cat bridge.key) -rpc-port 9958
```
