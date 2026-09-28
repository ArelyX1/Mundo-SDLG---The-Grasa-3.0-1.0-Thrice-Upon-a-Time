# PAPU -> PVM: hallazgos que corrigen el plan

## Correccion 1: el probe no probaba la entrada 5
`TestABIRoundTrip` tenia `entry := uint64(0)` hardcodeado, asi que la corrida
con `ENTRY=5` era identica a la anterior y no ejercito la entrada 5 en
absoluto. Ya lee `ENTRY` del entorno.

## Correccion 2: el assembler de texto pierde las secciones de datos
El blob enlazado (`polkatool link`) trae secciones 1..6 y 128..130: RO data
(8568 bytes), RW data, codigo (41636) y las secciones de import/export.

Al re-ensamblar desde texto, `polkatool assemble` solo reconstruye las
secciones 5 (metadatos) y 6 (codigo). Las secciones de datos desaparecen, y
el PVM Go falla con `panic: EOF` al pedir la seccion 2/3 que ya no existe.

Medido:

| blob | secciones |
|------|-----------|
| `papu-rs-econ.pol` (enlazado) | 1,2,3,4,5,6,128,129,130 |
| `papu-econ-dual.pol` (re-ensamblado) | 5,6 |

El guest depende de su `.rodata` (tablas de serde) y de su `.bss` (el arena
del allocator, 64 KiB). Sin esas secciones no puede ejecutar.

## Por que esto invalida el re-layouteo
La cadena llama `InvokeWholeProgram(c, 0)` para refine y
`InvokeWholeProgram(c, 5)` para accumulate. El linker no ofrece control sobre
donde caen los bloques: `collect_used_blocks` itera `all_blocks` por indice, no
por punto de entrada. Renombrar el export a `main` no mueve la entrada
(comprobado: el bloque en offset 0 sigue siendo un helper de serde y el export
queda en `@1390`).

La unica via que encontramos para forzar las entradas 0 y 5 es reensamblar el
codigo, y eso pierde los datos. El ciclo esta cerrado.

## Lo que si funciona
- `polkatool link -i revive_v1` produce un blob completo y valido.
- El pipeline Rust -> link -> PVM Go esta probado (round trip de storage).
- `polkatool assemble` ahora acepta `mulhu`/`mulhs`/`mulhsu` (la ISA siempre
  los tuvo; faltaba solo la gramatica del parser de texto). Esto es un fix
  real y reutilizable del assembler, independiente del port de PAPU.

## Opciones para seguir
1. **Cambiar las entradas que usa la cadena.** En vez de pelear con el layout,
   hacer que refine y accumulate apunten a las entradas que el linker produzca
   de forma natural, leyéndolas de la metadata de export del blob. Es lo mas
   limpio: el blob se usa tal cual lo emite el linker.
2. **Parchear el linker** para que respete un punto de entrada declarado.
   Trabajo en el fork, y es un cambio de verdad en polkavm-linker.
3. **Guest unico con una sola entrada.** Como ya sabemos distinguir refine de
   accumulate por la forma de los argumentos (NUL final), las dos invocaciones
   podrian usar la misma entrada. Requiere tocar refine.go y accumulate.go.
4. **Portar el guest a ensamblador/ISA donde controle el layout.** Descartado
   ya: el usuario eligio Rust.
