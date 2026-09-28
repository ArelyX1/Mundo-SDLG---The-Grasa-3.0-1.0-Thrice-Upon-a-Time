// The gateway is only allowed to be a door. These tests stand a fake chain behind
// one and check that every number the gateway answers is the number it was given,
// that it fails loudly when the node is gone, and that it never answers a question
// about a transaction it cannot know the answer to.
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import assert from 'node:assert/strict'
import { createEvmServer } from '../src/api/evm.js'
import { maybeLogger } from '../src/core/log.js'

type Answer = (method: string, params: unknown[]) => unknown

async function gateway(answer: Answer): Promise<{ url: string; asked: string[]; close: () => Promise<void> }> {
  const asked: string[] = []
  const chain = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const { method, params } = JSON.parse(body) as { method: string; params: unknown[] }
    asked.push(method)
    try {
      const result = answer(method, params)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))
    } catch (e) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: (e as Error).message } }))
    }
  })
  await new Promise<void>((done) => chain.listen(0, done))
  const chainPort = (chain.address() as AddressInfo).port

  // createEvmServer ya escucha en el puerto que se le da; 0 pide uno libre.
  const server = createEvmServer(`http://127.0.0.1:${chainPort}`, maybeLogger('error', 'test'), 0)
  await new Promise<void>((done) => server.once('listening', done))
  const port = (server.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${port}`,
    asked,
    close: async () => {
      // fetch deja conexiones abiertas, y close() espera a que terminen: sin esto
      // el test se queda esperando a un socket que no va a cerrar solo.
      server.closeAllConnections()
      chain.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
      await new Promise<void>((done) => chain.close(() => done()))
    },
  }
}

async function rpc(url: string, method: string, params: unknown[] = []): Promise<{ result?: unknown; error?: { message: string } }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await response.json()) as { result?: unknown; error?: { message: string } }
}

const nodeSays: Answer = (method) => {
  const answers: Record<string, unknown> = {
    eth_chainId: '0x1400',
    eth_blockNumber: '0x2a',
    eth_gasPrice: '0x0',
    eth_getBalance: '0x1bc16d674ec80000',
    eth_getTransactionCount: '0x3',
    eth_getBlockByNumber: { number: '0x2a', hash: '0xabc' },
    papucoin_chainParams: { symbol: 'PAPU', decimals: 12, bridgeAddress: 'sdlgTest' },
  }
  if (!(method in answers)) throw new Error(`el nodo no implementa ${method}`)
  return answers[method]
}

test('cada numero que responde la puerta es el que dio el nodo', async () => {
  const g = await gateway(nodeSays)
  try {
    assert.equal((await rpc(g.url, 'eth_chainId')).result, '0x1400')
    assert.equal((await rpc(g.url, 'eth_blockNumber')).result, '0x2a')
    assert.equal((await rpc(g.url, 'eth_getBalance', ['0x1111111111111111111111111111111111111111'])).result, '0x1bc16d674ec80000')
    assert.equal((await rpc(g.url, 'eth_getTransactionCount', ['0x1111111111111111111111111111111111111111'])).result, '0x3')
    assert.deepEqual((await rpc(g.url, 'eth_getBlockByNumber', ['latest', false])).result, { number: '0x2a', hash: '0xabc' })
    assert.ok(g.asked.includes('eth_getBalance'), 'el saldo tiene que venir del nodo, no de aqui')
  } finally {
    await g.close()
  }
})

test('la puerta no responde lo que no sabe', async () => {
  const g = await gateway(nodeSays)
  try {
    // Un recibo es informacion de una transaccion, y esta cadena no lleva indice
    // de transacciones: la puerta lo dice en vez de inventar un exito.
    assert.equal((await rpc(g.url, 'eth_getTransactionReceipt', ['0xdead'])).result, null)
    assert.equal((await rpc(g.url, 'eth_getTransactionByHash', ['0xdead'])).result, null)
    assert.deepEqual((await rpc(g.url, 'eth_accounts')).result, [])
    // No hay contratos en esta cadena, y el codigo vacio es la verdad.
    assert.equal((await rpc(g.url, 'eth_getCode', ['0x1111111111111111111111111111111111111111'])).result, '0x')
  } finally {
    await g.close()
  }
})

test('un error del nodo llega como error, no como un saldo de cero', async () => {
  const g = await gateway((method) => {
    if (method === 'eth_chainId') return '0x1400'
    throw new Error('esta cadena no corre codigo de contratos todavia')
  })
  try {
    const call = await rpc(g.url, 'eth_call', [{}])
    assert.equal(call.result, undefined)
    assert.match(call.error?.message ?? '', /no corre codigo de contratos/)
  } finally {
    await g.close()
  }
})

test('sin nodo la puerta falla en vez de contestar', async () => {
  const server = createEvmServer('http://127.0.0.1:1', maybeLogger('error', 'test'), 0)
  await new Promise<void>((done) => server.once('listening', done))
  const port = (server.address() as AddressInfo).port
  try {
    const call = await rpc(`http://127.0.0.1:${port}`, 'eth_chainId')
    assert.equal(call.result, undefined)
    assert.match(call.error?.message ?? '', /no respondio/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  }
})

test('la puerta manda la transaccion cruda tal cual, sin tocarla', async () => {
  const raw = '0x02f87582140080843b9aca008504a817c8008252089435353535353'
  const g = await gateway((method, params) => {
    if (method === 'eth_sendRawTransaction') return '0xfeed'
    return nodeSays(method, params)
  })
  try {
    const call = await rpc(g.url, 'eth_sendRawTransaction', [raw])
    assert.equal(call.result, '0xfeed', 'la puerta no reinterpretaria ni una byte de la firma: responde el hash que dio el nodo')
  } finally {
    await g.close()
  }
})
