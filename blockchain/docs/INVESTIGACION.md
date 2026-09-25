# Investigación: qué hay ya hecho y qué se reutilizó

Cuando pidieron "JAM de verdad, nada de Substrate", se investigó el estado de las implementaciones
de JAM (jun-sep 2026) antes de escribir una sola línea.

## Estado real de JAM

JAM (Join-Accumulate Machine) es una **especificación** (el *Gray Paper*, graypaper.com),
no un software. La comunidad la está implementando en paralelo bajo el JAM Implementer's Prize:

| implementación | lenguaje | estado (2026) |
|---|---|---|
| **typeberry** (`FluffyLabs/typeberry`) | TypeScript | M1: *import de bloques* conforme a test vectors de W3F + PVM (Ananas). Red parcial (M2). |
| **grey** (`bitarray/grey`) | Rust | 101/101 vectores de conformidad; nodo de importación. |
| jamdot / JAMNP / otros premios | Rust, Go, etc. | en curso, milestone 1 mayormente |

Además, el usuario tenía en local `LOCAL-JAM-LAN/` un tarball **polkajam 0.1.28** (Parity,
`polkajam --version` responde `GP 0.7.2`, es decir que implementa el Gray Paper 0.7.2). Se evaluó
como posible base:

- **Es JAM real** (protocolo Safrole) pero está **construido sobre el Polkadot SDK/Substrate**:
  el CLI es el estándar de Substrate (`--chain`, `gen-spec`, `dump-spec`, `--base-path`, chainSpec
  con pallets `system`/`balances`), así que falla el criterio "JAM, nada de Substrate".
- Es un **binario nightly sin código fuente** en el repo (solo el `.tgz`) → sin control de versiones
  ni parcheabilidad local.
- Y lo decisivo: en polkajam un servicio de economía solo puede vivir como **servicio JAM ejecutado
  por CoreVM** (blob PVM + preimages + DA), un rediseño completo que **toma semanas** y niega nuestro
  pipeline de consenso/refine actual.

**Decisión (sept 2026):** NO usar polkajam/LOCAL-JAM-LAN como base. Se conserva como oráculo de
referencia opcional (tests de conformidad) y como referencia de GP 0.7.2, pero el nodo del repo sigue
siendo el TS ligero fiel al Gray Paper. Si algún día se quiere correr en JAM pública, la ruta sigue
siendo "portar CRYPTOPAPU a una VM estándar" (ver hoja de ruta abajo).

Dato clave: ninguna implementación puede **hoy** levantar una red hóspinada con nuestro propio
servicio de economía. Web3 Summit 2026 puso el mainnet de JAM en **12-20 meses**, y el M1 evaluable
por el Fellowship es justamente "importar bloques correctamente", no "correr una red de aplicaciones".

## Qué se reutilizó (no reinventamos crypto ni transporte)

- **@noble/ed25519** y **@noble/hashes** (blake2b, sha512): firma y hashing probados en
  producción, cero dependencias nativas.
- **ws**: transporte P2P (WebSocket), estándar y mantenido.
- Modelos del Gray Paper aplicados tal cual: **work package/work item/work result/work report**,
  **core × timeslot**, **refine → accumulate → on_transfer**, **service index**, state root por
  compresión tipo Merkle.

## Por qué no "integrar typeberry/grey" hoy

1. **Red**: la red de JAM no existe aún (mainnet ≥2027). Su red parcial (M2) no levanta servicios
   de aplicación, y la meta de esos clientes es la conformidad, no alojar dApps.
2. **Servicios**: en JAM un servicio se despliega como código **PVM** (RISC-V con gas). No hay aún
   tooling estable para compilar un "servicio de economía" y registrarlo en esos nodos.
3. **Resultado**: mezclar un cliente M1 conformante con nuestro servicio implicaría meses de
   puente (PVM, preimages, DA) sin red que calibrar.

Por eso este repo entrega un **nodo ligero fiel a las semánticas del Gray Paper** con el que hoy se
puede: autohostear, producir bloques firma-do, consensuar estado, y operar CRYPTOPAPU (PAPU).
Decisión transparente y documentada.

## Camino de upgrade (hoja de ruta si se quiere JAM "real")

- [ ] **Consenso**: sustituir `src/consensus/authority.ts` (PoA por rotación) por **Safrole**
      (SSS/beacon) cuando haya una implementación de referencia publicable.
- [ ] **PVM**: correr `refine()` dentro de la **PVM** (Ananas de typeberry, AssemblyScript/RISC-V)
      en vez del switch de métodos del nodo; meter gas medible.
- [ ] **VM de servicios**: desplegar el servicio CRYPTOPAPU como blob de código con
      preimage + `serviceIndex`, en vez de módulos registrados en el repo.
- [ ] **Coretime**: asignación real de coretime (subasta/agile) y múltiples cores.
- [ ] **Conformidad**: evaluar nuestro importador contra los **test vectors de W3F** (`w3f/jamtestvectors`)
      para acercarse a M1; los vectores ya se pueden correr hoy aunque el resto no.
- [ ] Si el objetivo final es correr en la red JAM pública: **portar el contrato de economía a una
      VM estándar** (RISC-V/PVM) y desplegarlo como un **servicio estándar**.

## Referencias

- Gray Paper: https://graypaper.com · repo: https://github.com/gavofyork/graypaper
- Vectores: https://github.com/w3f/jamtestvectors · wiki: https://wiki.polkadot.com/learn/learn-jam-chain/
- Clientes: https://github.com/FluffyLabs/typeberry · https://github.com/bitarray/grey