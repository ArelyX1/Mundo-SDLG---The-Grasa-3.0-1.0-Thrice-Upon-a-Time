# El port de PAPU al PVM funciona de punta a punta

## Como se desbloqueo

La via obvia (forzar las entradas 0 y 5 re-ensamblando el codigo) esta cerrada:
`polkatool assemble` reconstruye solo las secciones de codigo y metadatos, y
descarta RO data, RW data e imports/exports. Sin las tablas de serde en
RO data el guest no arranca. Medido:

| blob | secciones |
|------|-----------|
| `polkatool link` | 1,2,3,4,5,6,128,129,130 |
| re-ensamblado | 5,6 |

La solucion adoptada es la que probo el propio proyecto: **no controlar el
layout, leerlo del blob**. El linker decide donde cae cada bloque, asi que el
host no debe hardcodear offsets: los lee de la metadata de exports.

## Los tres hallazgos que Costaron tiempo

### 1. El BSS no llega al blob
El allocator del guest vivia en `.bss` (64 KiB) y el linker solo emitio 8 bytes
de RW data. El PVM remata con un page fault en `0x40000`, justo el fin del
bloque de datos. La arena se movio a `.data` con `#[link_section = ".data"]`,
que si se incluye.

### 2. El orden de los ecalls lo decide el linker, no el guest
Esto es lo mas importante y contradice lo que se asumia. El linker numera los
imports **por el orden en que el guest los llama por primera vez**, no
alfabeticamente. El guest asumia `read=3, write=4` porque asi se llaman en el
host, pero el blob real contiene:

```
ecall 0 = "c3_read"
ecall 1 = "c4_write"
```

Con la suposicion equivocada el guest llamaba a `fetch` (id 1) y no escribia
nada. Por eso los indices se resuelven leyendo la tabla de imports del blob y
traduciendolos por nombre al id canonico del host.

### 3. Los varints de polkavm no son varints estandar
`length = (!first_byte).leading_zeros()`, y el valor combina los bits no
prefijo del primer byte con los bytes siguientes en little-endian. Un lector
base-128 convencional produce offsets absurdos (1283136 en vez de 20136).

## Donde quedo

El guest (Rust, `polkavm-derive`, sin std) corre bajo el PVM Go real:

- **refine**: parsea un `Item` JSON y devuelve el reporte `Op`. Verificado con
  `welcome`: devuelve exactamente las claves que produce el nativo, en el mismo
  orden, y para `welcome` omite `amount` y `fee` como hace el nativo.
- **accumulate**: aplica el reporte sobre storage real via `host_call`
  Read/Write. Verificado con `welcome`: escribe el marker de claim, el balance y
  el supply, y los numeros cuadran al digito (5*10^12).

Ambos modos usan **el mismo export**, distinguidos por el byte NUL final en los
argumentos.

## Corregido de paso

- `TestABIRoundTrip` tenia `entry := uint64(0)` hardcodeado, asi que la
  corrida con `ENTRY=5` nunca ejercito la entrada 5. Ahora lee el entorno.
- `polkatool assemble` no parseaba `mulhu`/`mulhs`/`mulhsu`, que la ISA siempre
  tuvo; faltaba solo la gramatica del parser de texto. Fix en
  `polkavm-common/src/assembler.rs`, reusable por cualquiera que reensamble.

## Lo que falta

- **Firmas**: `must_be_signed` y `raw` devuelven reporte vacio. Falta Ed25519
  con el dominio `SDLG-PAPU::1`, y el relay RLP + ecrecover.
- **Direcciones de cadena**: hoy solo se validan EVM (`0x` + 40 hex). Falta
  canonicalizar `sdlg` + base58(pubkey || blake2b-256(pubkey)[:4]), que es
  sensible a mayusculas y no debe pasar por un `to_ascii_lowercase`.
- **Invocacion desde la cadena**: falta cablear el dispatcher traducido en
  `refine.go` y `accumulate.go`; hoy la traduccion vive en los tests.
- **Guest unico vs dos entradas**: la cadena sigue llamando 0 y 5; con esta
  solucion ambas invocaciones deben apuntar al export resuelto.

## Comandos

```bash
# guest
cd /tmp/opencode/papu-guest-rs && cargo +nightly-2025-05-10 build --release

# enlace (el flag -i vive en nuestro fork de polkavm)
polkatool link -i revive_v1 -o /tmp/opencode/papu-rs-econ.pol \
  target/riscv64emac-unknown-none-polkavm/release/papu-guest-rs

# pruebas, con la entrada y el mapeo de ecalls leidos del blob
BLOB=/tmp/opencode/papu-rs-econ.pol ARGS_FILE=/tmp/opencode/args-acc.bin \
  go test ./internal/pvm -run 'TestPolkavmBlob|TestPAPUEconomy' -v -count=1
```
