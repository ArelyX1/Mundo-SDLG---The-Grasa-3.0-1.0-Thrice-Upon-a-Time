# Referencias

Repos de terceros clonados **solo como material de consulta**. No forman parte
del proyecto, no se versionan y no se compilan: existen para poder leer la
implementación de referencia cuando una decisión de diseño necesita contrastar
con el original.

| Repo | Licencia | Para qué se consulta |
| --- | --- | --- |
| [`dcrd`](https://github.com/decred/dcrd) | ISC | `dcrec/secp256k1/v4` es la dependencia del firmante EVM. `ecdsa.RecoverCompact` implementa la recuperación de la clave pública (SEC1 §4.1.6) que necesita el relay de PAPU. Se usa como módulo versionado, el código no se copia. |
| [`polkavm`](https://github.com/paritytech/polkavm) | Apache-2.0 | La PVM de referencia. Su linker es lo que convierte un binario RISC-V en un blob PVM, la pieza que le falta al nodo para compilar un service de verdad. También fija la ABI de host calls a la que debe alinearse el `Context` del SDK. |
| [`ajanta`](https://github.com/Chainscore/ajanta) | MIT | SDK de services en C que sí produce blobs PVM. Sirve como ejemplo trabajado de la ABI real de host calls. |

## Por qué están aquí y no versionados

Son lecturas, no dependencias. Copiar su código dentro del proyecto traería
licencias ajenas y una deuda de mantenimiento que no queremos. Lo que sí se usa
del exterior se declara como dependencia en `jam/go.mod` y queda fijado a una
versión.

## Si necesitas recrearlos

Como submódulos, `git submodule update --init references/` los materializa en
el commit fijado. Para actualizar una referencia concreta:

```sh
cd references/dcrd
git fetch --depth 1 origin master
git checkout FETCH_HEAD
```

`dcrd` y `ajanta` están clonados de forma dispersa (`--filter=blob:none
--sparse`) porque solo se necesitan subcarpetas concretas del primero.

## Son submódulos

Cada repo es un submódulo de este proyecto, así que el commit exacto está
fijado en el gitlink que registra la raíz y no se mueve solo:

| Submódulo | Commit fijado |
| --- | --- |
| `dcrd` | `3fe61c0` |
| `polkavm` | `dddfddb` |
| `ajanta` | `3739e30` |

Para materializarlos:

```sh
git submodule update --init references/
```

Para consultar una versión distinta, muévete a ese commit dentro del submódulo
y súbelo desde la raíz. Un submodule de referencia que cambia deserves un
commit en la raíz que deje claro por qué.

`node-go` también es submódulo, pero ese sí es código nuestro y está
versionado en serio: se mueve cada vez que commiteamos el nodo. Las
referencias solo cambian cuando queremos actualizar la referencia.

