# Las tres formas de transaccion EVM, y por que importaba

## El hallazgo

El host aceptaba las tres formas que define Ethereum: legacy (pre-2718),
EIP-2930 y EIP-1559. El guest solo entendia EIP-1559.

La consecuencia era concreta: una wallet cuya libreria emite una transaccion
legacy o 2930 beat aceptada por el host y luego rechazada por el guest con
`no es una transaccion tipada 0x02`. La wallet veia su transferencia
rechazada sin motivo apparent, y el operador del nodo no veia nada raro porque
para la cadena todo estaba bien.

Que forma emita una wallet es decision de su libreria, no de la cadena. Un
guest que solo entienda una de las tres convierte transferencias legitimas en
rechazos.

## Por que no se nota en las pruebas

Porque las pruebas usaban la misma forma que el guest entendia. Solo aparecio
al correr las tres contra el nodo: el receptor recibia 250 de 750 micro-PAPU,
porque solo una de las tres se aplicaba.

## Los campos no estan en el mismo sitio

| | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| legacy | nonce | gasPrice | gas | **to** | **value** | data | v |
| EIP-2930 | chainId | nonce | gasPrice | gas | **to** | **value** | data |
| EIP-1559 | chainId | nonce | tip | fee | gas | **to** | **value** |

Legacy no tiene type byte, asi que tampoco tiene `chainId` como campo: el id
va plegado dentro de `v` como `chainId*2 + 35 + parity`, y el guest lo
comprueba ahi. Un guest que lo buscara como campo propio rechazaria toda
transaccion legacy.

## La correccion

El guest decide la forma por el primer byte y lee `to` y `value` del indice que
corresponde. El host ya verificaba la firma en las tres; solo faltaba que el
guest supiera leerlas.

Anadido de paso `SignEVMLegacy` y `SignEIP2930` al SDK, que solo tenia el
firmante de EIP-1559: sin ellos no habia forma de producir una transaccion de
esas formas para probarlas.

## Verificacion

El smoke test manda las tres contra el nodo y el receptor debe recibir la suma
de las tres. Antes recibia una; ahora recibe `0.00000000075` PAPU, que es
exactamente 250 x 3 micro-PAPU.

Y hay un test por forma que ademas comprueba que el host las acepta, porque si
el host rechazara una, el unico arreglo posible estaria en el guest y el fallo
se veria igual desde fuera.
