#!/usr/bin/env node
// Genera el genesis del nodo JAM en Go a partir del genesis de node-ts.
//
// Las dos redes comparten economia pero no estado: las claves de PAPU en Go son
// prefijos de un byte (0x01..0x08) y en TypeScript son cadenas
// ("papucoin/balance/PAPU/<dir>"), asi que la state root nasce distinta. Lo que
// si se copia son las cuentas, el emisor y los saldos iniciales, para que las
// dos redes repartan exactamente el mismo dinero.
//
// Las cuentas se copian como clave publica, nunca como direccion: el checksum de
// una direccion sdlg es blake2b con digest de 4 bytes, que no se puede calcular
// ni en Node (solo hay blake2b-512) ni en Go (x/crypto solo ofrece 256/384/512),
// asi que cada implementacion define el suyo. La clave publica es la identidad,
// y el nodo Go deriva su propia direccion a partir de ella, con su checksum.
//
//   node tools/genesis-from-ts.mjs [node-ts/genesis/genesis.json] [salida.json]

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const here = dirname(new URL(import.meta.url).pathname)
const root = resolve(here, '..')

const source = resolve(process.argv[2] ?? `${root}/node-ts/genesis/genesis.json`)
const target = resolve(process.argv[3] ?? `${root}/node-go/genesis/chain-dev.json`)

const ts = JSON.parse(readFileSync(source, 'utf8'))
const economy = ts.economy ?? {}

if (typeof economy.maxSupply !== 'string' || economy.maxSupply === '') {
  fail(`el genesis de origen no declara economy.maxSupply: ${source}`)
}
if (typeof economy.issuer !== 'string' || economy.issuer === '') {
  fail(`el genesis de origen no declara economy.issuer: ${source}`)
}

// Todas las cantidades de este genesis van en unidades de PAPU, igual que las
// del genesis de node-ts, y el nodo las convierte a unidades base al cargarlas.
// Escribir el genesis en unidades humanas evita tener que contar los ceros.
const decimals = economy.decimals ?? 12

// El endowment de la cuenta del service se mide en unidades del estado JAM, no
// en PAPU: es el saldo con el que la cuenta paga el alquiler de su storage. El
// minimo es 100 + 10 por item + 1 por octeto, asi que 1e12 deja margen de sobra
// para miles de cuentas y sigue cabiendo en un uint64.
const endowment = 1_000_000_000_000n

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

const base58Decode = (input) => {
  const bytes = [0]
  for (const character of input) {
    const value = base58Alphabet.indexOf(character)
    if (value < 0) fail(`${input} no es base58`)
    let carry = value
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Cada '1' inicial es un byte cero inicial, y el bucle de arriba ya los metio.
  for (const character of input) {
    if (character !== base58Alphabet[0]) break
    bytes.push(0)
  }
  return Uint8Array.from(bytes.reverse())
}

// publicKeyOf extrae la clave publica de una direccion sdlg.
const publicKeyOf = (address) => {
  if (!address.startsWith('sdlg')) fail(`${address} no es una direccion sdlg`)
  const decoded = base58Decode(address.slice('sdlg'.length))
  if (decoded.length !== 36) {
    fail(`${address} no decodifica a 36 bytes, sino a ${decoded.length}`)
  }
  return [...decoded.subarray(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const genesis = {
  network: ts.network ?? 'sdlg-jam',
  description:
    'Economia CRYPTOPAPU (PAPU) como service JAM sobre el nodo Go. Las claves de ' +
    'estado son las del SDK de Go, no las de node-ts, asi que la state root de esta ' +
    'red no coincide con la de la red TypeScript.',
  generatedFrom: source.replace(`${root}/`, ''),
  timeslotSecs: ts.timeslotSecs ?? 6,
  service: {
    id: 0,
    name: 'CRYPTOPAPU',
    symbol: 'PAPU',
    decimals,
    maxSupply: String(economy.maxSupply),
    // 1 micro-PAPU, que es lo que la cadena original cobraba por transferencia.
    transferFee: '0.000001',
    faucetAmount: '10000',
    welcomeAmount: '5',
    firstNonce: 1,
    endowment: endowment.toString(),
    // El emisor y las cuentas se expresan como clave publica; el nodo deriva la
    // direccion canónica de cada una.
    issuer: publicKeyOf(economy.issuer),
    accounts: Object.entries(economy.initialBalances ?? {})
      .map(([address, amount]) => ({ publicKey: publicKeyOf(address), amount: String(amount) }))
      .sort((a, b) => (a.publicKey < b.publicKey ? -1 : 1)),
  },
  evm: {
    chainId: 5120,
    name: 'Mundo SDLG',
    symbol: 'PAPU',
    // La capa EVM expone 18 decimales: 1 PAPU = 10^12 raw = 10^18 wei.
    decimals: 18,
  },
}

writeFileSync(target, `${JSON.stringify(genesis, null, 2)}\n`)

console.log(`genesis escrito en ${target}`)
console.log(`  emisor        ${genesis.service.issuer}`)
console.log(`  supply max    ${genesis.service.maxSupply} ${genesis.service.symbol}`)
console.log(`  endowment     ${genesis.service.endowment} (unidades JAM)`)
console.log(`  saldos        ${genesis.service.accounts.length} cuentas`)
console.log(`  origen        ${genesis.generatedFrom}`)

function fail(message) {
  console.error(message)
  process.exit(1)
}
