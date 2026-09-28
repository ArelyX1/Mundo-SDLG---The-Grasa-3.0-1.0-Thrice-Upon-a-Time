// Smoke de lo que existe: la cadena de node-go y la puerta EVM de este repo.
//
// La prueba levanta el nodo de Go de verdad, le habla por la puerta como lo haria
// una billetera, y comprueba que un saldo que se lee aqui es el mismo saldo que la
// cadena commiteo, y que una transaccion firmada por una clave que el nodo nunca
// vio mueve ese mismo saldo. Si algo de esto pasa, la red no funciona.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEvmServer } from '../src/api/evm.js'
import { maybeLogger } from '../src/core/log.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const NODE_GO = join(REPO, 'node-go')
const GENESIS = join(REPO, 'genesis', 'chain-dev.json')
const DIR = mkdtempSync(join(tmpdir(), 'sdlg-gateway-'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Una transaccion EIP-1559 firmada por una clave que este repo no tiene, generada
// por tools/evm-vectors con una implementacion independiente. Nonce 0, 5 PAPU, para
// la direccion 0x3535..., que es lo que manda una billetera que nunca ha enviado.
const SIGNER = '0x718fae2e5c6ba915a210b7f6e85246db915b9c03'
const RECEIVER = '0x3535353535353535353535353535353535353535'
const RAW_TX =
  '0x02f87582140080843b9aca008504a817c800825208943535353535353535353535353535353535353535884563918244f4000080c080a0102ad6d79c7e6f3dee16db944ff8a8f2c13c7777164a1d36e5b739327758a8dda06b875f8181ba400635cf14f37d1432d0d5abacfbc3d5753397171205550607fd'

const PORT = 51544
const GATEWAY_PORT = 51545

type Answer = { result?: unknown; error?: { message: string } }

async function rpc(port: number, method: string, params: unknown[] = []): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await response.json()) as Answer
}

/** Waits for a balance to be what it should be, because work lands on a timeslot. */
async function balanceOf(port: number, address: string, want: bigint, what: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const answer = await rpc(port, 'eth_getBalance', [address, 'latest'])
    if (answer.result !== undefined && BigInt(answer.result as string) === want) return
    await sleep(1000)
  }
  const answer = await rpc(port, 'eth_getBalance', [address, 'latest'])
  assert.fail(`${what}: la puerta nunca llego a ${want}, y la cadena dice ${String(answer.result ?? answer.error?.message)}`)
}

async function main(): Promise<void> {
  console.log('=== Smoke: cadena node-go + puerta EVM ===')
  rmSync(DIR, { recursive: true, force: true })

  if (!existsSync(join(NODE_GO, 'go.mod'))) {
    console.log('no hay node-go al lado; este smoke necesita el repositorio completo')
    process.exit(1)
  }

  console.log('--- compilando el nodo de Go ---')
  const build = spawnSync('go', ['build', '-tags', 'dev', '-o', join(DIR, 'strawberry'), './cmd/strawberry'], {
    cwd: NODE_GO,
    encoding: 'utf8',
  })
  if (build.status !== 0) {
    console.error(build.stderr)
    process.exit(1)
  }

  console.log('--- levantando la cadena ---')
  const node = spawn(join(DIR, 'strawberry'), [
    '--data-dir', join(DIR, 'chain'),
    '--rpc-port', String(PORT),
    '--bridge-wallet', '01'.repeat(32),
    '--port', String(PORT + 100),
    '--validator', `0@127.0.0.1:${PORT + 100}`,
    // El nodo lee su appconfig.json del directorio de trabajo, como siempre.
  ], { stdio: ['ignore', 'inherit', 'inherit'], cwd: NODE_GO })

  const gateway = createEvmServer(`http://127.0.0.1:${PORT}`, maybeLogger('warn', 'smoke'), GATEWAY_PORT)

  const stop = (): void => {
    gateway.closeAllConnections()
    gateway.close()
    node.kill('SIGKILL')
    rmSync(DIR, { recursive: true, force: true })
  }
  process.on('exit', stop)

  try {
    // El nodo responde antes de producir su primer bloque, asi que esperar por el
    // chainId no dice que la cadena este viva: hay que verla avanzar.
    let alive = false
    for (let attempt = 0; attempt < 40 && !alive; attempt++) {
      const answer = await rpc(GATEWAY_PORT, 'eth_blockNumber')
      alive = answer.result !== undefined && Number(answer.result) > 0
      if (!alive) await sleep(1000)
    }
    assert.ok(alive, 'la cadena no produjo ningun bloque')

    console.log('--- la puerta presenta la red ---')
    assert.equal((await rpc(GATEWAY_PORT, 'eth_chainId')).result, '0x1400', 'chainId 5120 en hex')
    assert.equal((await rpc(GATEWAY_PORT, 'net_version')).result, '5120')
    assert.equal((await rpc(GATEWAY_PORT, 'eth_gasPrice')).result, '0x0', 'esta cadena no cobra gas')

    const first = Number((await rpc(GATEWAY_PORT, 'eth_blockNumber')).result as string)
    await sleep(8000)
    const second = Number((await rpc(GATEWAY_PORT, 'eth_blockNumber')).result as string)
    assert.ok(second > first, `la cadena tiene que avanzar: ${first} -> ${second}`)

    console.log('--- el faucet de la cadena paga a una direccion EVM ---')
    const faucet = (await (
      await fetch(`http://127.0.0.1:${GATEWAY_PORT}/evm/faucet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: SIGNER }),
      })
    ).json()) as { accepted: boolean; amount: string }
    assert.equal(faucet.accepted, true)
    assert.equal(faucet.amount, '10000', 'el faucet paga lo que dice el genesis')
    await balanceOf(GATEWAY_PORT, SIGNER, 10_000n * 10n ** 18n, 'el faucet')

    console.log('--- una transaccion firmada por una clave desconocida mueve el saldo ---')
    const send = await rpc(GATEWAY_PORT, 'eth_sendRawTransaction', [RAW_TX])
    assert.ok(send.result, `la transaccion no se acepto: ${send.error?.message ?? ''}`)
    await balanceOf(GATEWAY_PORT, RECEIVER, 5n * 10n ** 18n, 'el destino de la transaccion')

    // Lo que el faucet.multiplo le queda al remitente: el faucet menos lo enviado
    // menos la comision de la cadena. Son 0.000001 PAPU en unidades de la cadena,
    // que son 10^12 wei porque el wei tiene seis decimales mas que el PAPU.
    const FEE_WEI = 1_000_000n * 10n ** 6n
    const left = BigInt((await rpc(GATEWAY_PORT, 'eth_getBalance', [SIGNER, 'latest'])).result as string)
    assert.equal(left, 10_000n * 10n ** 18n - 5n * 10n ** 18n - FEE_WEI,
      'al remitente le queda el faucet menos el envio y la comision')

    console.log('--- lo que la cadena no puede hacer, lo dice ---')
    const call = await rpc(GATEWAY_PORT, 'eth_call', [{ to: RECEIVER, data: '0x70a08231' }])
    assert.equal(call.result, undefined)
    assert.match(call.error?.message ?? '', /does not run contract code/,
      'el error tiene que decir que no hay codigo de contratos, no fallar sin decir por que')
    assert.equal((await rpc(GATEWAY_PORT, 'eth_getTransactionReceipt', ['0xdead'])).result, null)

    console.log('\nOK: la cadena de node-go responde, y la puerta no le anade nada.')
    stop()
    process.exit(0)
  } catch (e) {
    console.error('\nSMOKE FAIL:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  }
}

void main()
