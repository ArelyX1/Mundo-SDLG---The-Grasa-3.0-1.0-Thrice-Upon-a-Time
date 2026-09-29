# Dos wallets contra la cadena real, con la economia como guest

## Lo que se verifica

`tools/walletsmoke` arranca contra un nodo que corre con la economia de PAPU
como guest polkavm, y mueve saldo real por los dos caminos de confianza que
tiene una wallet:

| Wallet | Que tiene | Camino | Resultado |
|--------|-----------|--------|-----------|
| EVM | clave secp256k1 | `papucoin_faucet` (paga el node) | 10 000 PAPU |
| EVM | clave secp256k1 | `eth_sendRawTransaction` (firma propia) | 750 micro-PAPU al receptor |
| cadena | clave ed25519 `sdlg...` | `papucoin_submit` con item firmado | 5 000 PAPU |

El supply se comprobó contra la suma: subio exactamente lo que las wallets
movieron, y las claves de storage las escribio el guest.

## Los caminos de confianza

Son dos, y ninguno se salta al otro:

- **Firma ed25519 sobre el item.** El campo `sender` esta cubierto por la
  firma, asi que un item no puede convertirse en un envio desde otra cuenta.
  El guest lo verifica en refine, contra el dominio `SDLG-PAPU::1`.
- **Firma secp256k1 de Ethereum.** El remitente se recupera de la firma, no de
  lo que el item dice. El destino tiene que coincidir con los bytes firmados,
  o una transaccion valida podria|Apuntar al saldo de otro.

## Decisiones que shun aparecieron

### La firma EVM la verifica el host, no el guest

`k256::ecrecover` compila en no_std pero entra en panic dentro de la libreria:
la aritmetica de curva necesita algo que un guest sin libreria estandar no tiene.
Se llevo mucho rato diagnostics hasta que quedo claro que no era un bug mio.

La solucion es mejor architectonicamente ademas de mas simple: el host ya
tenia un ecrecover probado (`sdk/papucoin/evmtx.go`, con dcrd), lo usa, y le
pasa al guest el remitente en un campo `evmSender`. El guest lo ignora salvo
que el host lo haya puesto.

**Confiar en el host no es un agujero: el host ES la cadena.** El guest es
programa que la cadena eligio ejecutar. La cadena respondiendo "este remitente
es tal" es el modelo entero, no una excepcion.

El guest perdio 200 KB de blob y la dependencia `k256`.

### El chain id lo dice la cadena, no el guest

Estaba fijo en 1 dentro del guest, y la cadena presenta 5120. Toda transaccion
se rechazaba con "la cadena no coincide". Ahora el seed escribe el chain id en
storage y el guest lo lee; una cadena que no dice cual es acepta nada relayed,
que es la respuesta segura.

### El guest escribe su propio estado del genesis

`PVMExecutor.Initialize` era un no-op, asi que el issuer arrancaba en cero y la
cadena no podia pagar un solo faucet. Ahora el seed (issuer, simbolo, saldos
iniciales, chain id) se pasa al guest y lo escribe en su propio storage, igual
que el seed nativo. Un issuer en cero es una cadena muerta, asi que sin seed el
executor da error en vez de devolver una cuenta vacia.

### Varios reports en un mismo lote

Varios items se refinan en el mismo timeslot y todos sus reports llegan al
guest en un solo buffer. Un lector que se detuviera en el primero perderia el
resto en silencio: los items se aceptarian y el dinero no se moveria. Hay un
test que lo fija con tres faucets en un lote y comprueba ademas que repetirlos
no vuelve a pagar, gracias al marker de reclamo.

## Correcciones que la prueba forzo

- El `chainID` del smoke venia en 1 mientras la cadena presenta 5120: toda
  transaccion relayed se rechazaba.
- `welcome` y `burn` no estaban en la lista de metodos que `Submit` acepta,
  aunque el servicio los implementa. `mint` sigue fuera a proposito: solo el
  issuer puede acuñar, y el issuer es la cadena.
- El nonce del faucet lo elige el node, y el servicio solo acepta el que espera.
  El node lo relee del estado despues de cada accumulate, porque la reserva del
  faucet tambien mueve esa cuenta.

## Ejecutar

```sh
# el nodo, con la economia como guest
./strawberry -validator -rpc-port 10025 -genesis chain-con-guest.json \
  -config appconfig.json -bridge-wallet $(cat bridge.key)

# las dos wallets
go run ./tools/walletsmoke -rpc http://localhost:10025 -chain-id 5120
```

El binario del nodo se queda en background con un bucle que lo relanza; el shell
de la sesion lo mata si se lanza en primer plano.
