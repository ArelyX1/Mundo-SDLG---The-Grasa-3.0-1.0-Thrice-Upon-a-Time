import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Logger } from '../core/log.js'
import { EVM_CHAIN_ID, EVM_CHAIN_NAME, isEvmAddress, normalizeEvmAddress, keccakHex } from '../evm/evm.js'
import { hexToBytes } from '../core/crypto.js'
import { PAPU_TOKEN } from '../evm/erc20.js'

type Json = Record<string, unknown>

/**
 * This process is a gateway and nothing else. The chain lives in node-go: this
 * file holds no keys, keeps no blocks, has no opinion about a balance, and never
 * builds a work item. Every number it answers is a number it read from the node
 * over JSON-RPC, which is what makes "there is one chain" true rather than a
 * claim. What it does add is the shape a wallet expects: HTTP, the endpoints
 * MetaMask needs to add the network, and the units Ethereum counts in.
 */

/** Icono de la red (Mundo SDLG): media/Mundo-SDLG-256.png (from sdlg.webp). */
const __dirname = dirname(fileURLToPath(import.meta.url))
let iconBytes: Buffer | null = null
for (const p of [
  join(process.cwd(), 'media', 'Mundo-SDLG-256.png'),
  join(__dirname, '..', '..', 'media', 'Mundo-SDLG-256.png'),
]) {
  if (existsSync(p)) {
    iconBytes = readFileSync(p)
    break
  }
}

/** Icono de la red (sdlg), servido en HTTPS (EIP-3085: MetaMask ignora iconUrls en http://). */
function iconUrl(port: number): string {
  const hosted = process.env.JAM_EVM_ICON_URL
  if (hosted) return hosted
  return `https://files.catbox.moe/${NETWORK_ICON_FILE}`
}

/** Icono del token PAPU (pacman), usado por wallet_watchAsset (HTTPS). */
function tokenImageUrl(): string {
  const hosted = process.env.JAM_EVM_TOKEN_IMAGE_URL
  if (hosted) return hosted
  return `https://files.catbox.moe/qohmwt.png`
}

/** Archivo del icono de red (sdlg -> png) subido a https://files.catbox.moe. */
const NETWORK_ICON_FILE = 'x6tiah.png'

/** Pagina minima de conexion: wallet_addEthereumChain con iconUrls para que MetaMask muestre el logo. */
function connectHtml(port: number): string {
  const icon = iconUrl(port)
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Mundo SDLG - agregar red</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f1116;color:#e6e6e6;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.5}
h1{vertical-align:middle}
button{background:#6c5ce7;color:#fff;border:0;padding:12px 18px;border-radius:8px;font-size:15px;cursor:pointer;margin-top:8px;margin-right:8px}
code{background:#1d2330;padding:2px 6px;border-radius:4px}
pre{background:#1d2330;padding:12px;border-radius:8px;overflow:auto;white-space:pre-wrap}
.ok{color:#2ecc71}.err{color:#e74c3c}
</style></head><body>
<h1><img src="${icon}" width="48" height="48" alt="logo"> Mundo SDLG</h1>
<p>Conecta MetaMask con <b>CRYPTOPAPU (PAPU)</b> en la red <code>${EVM_CHAIN_NAME}</code> (chainId <code>${EVM_CHAIN_ID}</code>, sin contratos: solo transferencias PAPU).</p>
<div>
<button onclick="connectAndWelcome()">Agregar red y conectar (faucet de la cadena)</button>
</div>
<p style="font-size:12px;color:#95a5a6">La moneda nativa de esta red es <b>PAPU</b>: se ve en el saldo de la cuenta y se envia con el boton <b>Enviar</b> de MetaMask, sin importar ningun token.</p>
<p style="font-size:12px;color:#95a5a6">Esta cadena todavia no ejecuta codigo de contratos, asi que no hay token ERC-20 que importar y las llamadas <code>eth_call</code> responden con un error que lo dice. Cuando exista un contrato real, aparecera aqui su direccion.</p>
<p style="font-size:12px;color:#95a5a6">Este servidor es una puerta: la cadena corre en node-go. Los saldos y los envios se leen de ahi, y lo que se envia se firma con la clave de la billetera, no con una clave guardada aqui.</p>
<pre id="log">Esperando...</pre>
<script>
const RPC=location.origin;
const SYMBOL='${PAPU_TOKEN.symbol}';
function log(msg,cls){const l=document.getElementById('log');l.className=cls||'ok';l.textContent=msg;}
async function activeAccount(){
  const eth=window.ethereum;
  await eth.request({method:'eth_requestAccounts'});
  return (await eth.request({method:'eth_accounts'}))?.[0];
}
async function addNet(){
  try{
    const eth=window.ethereum;
    if(!eth){log('MetaMask no esta instalado/inyectado. Abre esta pagina en Chrome/Edge con la extension activa.','err');return;}
    log('Solicitando a MetaMask...');
    await eth.request({method:'wallet_addEthereumChain',params:[{
      chainId:'0x${EVM_CHAIN_ID.toString(16)}', chainName:'${EVM_CHAIN_NAME}',
      nativeCurrency:{name:'${PAPU_TOKEN.name}',symbol:'${PAPU_TOKEN.symbol}',decimals:18},
      rpcUrls:[RPC],
      iconUrls:['${icon}', RPC+'/evm/icon.png']
    }]});
    await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x${EVM_CHAIN_ID.toString(16)}'}]});
    log('Red ${EVM_CHAIN_NAME} agregada y conectada.');
  }catch(e){log('Error: '+e.message,'err');}
}
async function claimWelcome(addr){
  if(!addr) return;
  try{
    const r=await fetch(RPC+'/evm/faucet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:addr})});
    const j=await r.json();
    if(j.accepted){
      log('Faucet de la cadena: +'+j.amount+' '+SYMBOL+' para '+addr.slice(0,6)+'\\\\u2026'+addr.slice(-4)+'.');
    }else if(j.once===false){
      log('Esta cuenta ya recibio el faucet: la cadena lo paga una sola vez por direccion.');
    }else{
      log('Faucet: '+(j.error||'error'),'err');
    }
  }catch{}
}
async function connectAndWelcome(){
  await addNet();
  const acc=await activeAccount();
  await claimWelcome(acc);
}
window.ethereum?.on?.('accountsChanged',(a)=>claimWelcome(a?.[0]));
</script>
</body></html>`
}

const toQ = (n: bigint | number): string => '0x' + BigInt(n).toString(16)

/** An RPC error from upstream, kept as it was so the code survives the trip. */
class UpstreamError extends Error {
  code: number
  constructor(message: string, code: number) {
    super(message)
    this.code = code
  }
}

export function createEvmServer(upstream: string, log: Logger, port: number): Server {
  /**
   * Asks the node the only authority there is. A failure here is this gateway
   * saying it does not know, never the gateway inventing an answer, because an
   * invented balance is the one number a wallet cannot check.
   */
  const ask = async (method: string, params: unknown[] = []): Promise<unknown> => {
    let response: Response
    try {
      response = await fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    } catch (e) {
      throw new UpstreamError(`el nodo no respondio (${upstream}): ${e instanceof Error ? e.message : String(e)}`, -32003)
    }

    const body = (await response.json()) as { result?: unknown; error?: { code?: number; message?: string } }
    if (body.error) throw new UpstreamError(body.error.message ?? 'error del nodo', body.error.code ?? -32000)
    return body.result
  }

  /** The methods the node answers, forwarded as they are and without a second opinion. */
  const forwarded = new Set([
    'eth_chainId',
    'eth_blockNumber',
    'eth_getBalance',
    'eth_getTransactionCount',
    'eth_gasPrice',
    'eth_getBlockByNumber',
    'eth_sendRawTransaction',
    'eth_call',
    'eth_estimateGas',
  ])

  const info = async (): Promise<Json> => {
    const [chainId, blockNumber, gasPrice, chainParams] = await Promise.all([
      ask('eth_chainId'),
      ask('eth_blockNumber'),
      ask('eth_gasPrice'),
      ask('papucoin_chainParams'),
    ]) as [unknown, unknown, unknown, Json]
    return {
      service: `EVM gateway (${PAPU_TOKEN.name} / ${PAPU_TOKEN.symbol})`,
      network: EVM_CHAIN_NAME,
      upstream,
      chainId: Number(chainId),
      blockNumber: Number(blockNumber),
      gasPrice,
      symbol: chainParams.symbol,
      decimals: chainParams.decimals,
      bridge: chainParams.bridgeAddress,
      faucet: 'POST /evm/faucet {"address":"0x..."}',
      icon: iconUrl(port),
      // Sin contrato no hay token que importar, y ofrecer una direccion sin
      // codigo seria una promesa que la cadena no puede cumplir.
      token: null,
      // Said out loud because a wallet that is not told will wait for a receipt
      // that this chain cannot produce: the blocks of this chain carry a state
      // root and a timeslot, not a list of transactions, so there is no per
      // transaction receipt to look up.
      receipts: 'esta cadena no lleva un indice de transacciones: eth_getTransactionReceipt responde null y el saldo es la prueba',
    }
  }

  const ethFaucet = async (address: string): Promise<Json> => {
    if (!isEvmAddress(address)) return { accepted: false, error: 'direccion 0x invalida', to: address }
    const result = (await ask('papucoin_faucet', [normalizeEvmAddress(address)])) as Json
    return { accepted: result.accepted === true, amount: result.amount, once: result.once === true, pending: result.pending }
  }

  const dispatch = async (method: string, call: unknown[]): Promise<unknown> => {
    const params = call as unknown[]
    if (forwarded.has(method)) return ask(method, params)

    switch (method) {
      case 'web3_clientVersion':
        return 'sdlg-jam-gateway/0.2.0'

      case 'web3_sha3': {
        const data = String(params[0] ?? '')
        return '0x' + keccakHex(hexToBytes(data.startsWith('0x') ? data.slice(2) : data))
      }

      case 'net_version':
        return String(EVM_CHAIN_ID)

      case 'net_listening':
        return true

      case 'net_peerCount':
        // Peers are the node's business, and this gateway is not a node.
        return toQ(0)

      case 'eth_protocolVersion':
        return '0x41'

      case 'eth_accounts':
        return []

      case 'eth_syncing':
        return false

      case 'eth_maxPriorityFeePerGas':
        return toQ(0)

      case 'eth_feeHistory':
        return { oldestBlock: toQ(0), baseFeePerGas: [], gasUsedRatio: [], reward: [] }

      // This chain has no contracts, and answering as if it had would be the
      // one lie a wallet cannot check: code at an address that does not exist.
      case 'eth_getCode':
        return '0x'

      case 'eth_getStorageAt':
        return '0x'

      case 'eth_getLogs':
      case 'eth_getFilterChanges':
      case 'eth_getFilterLogs':
        return []

      case 'eth_sendTransaction':
        throw Object.assign(new Error('firme desde la wallet: use eth_sendRawTransaction'), { code: -32000 })

      // Blocks are identified by the node's hash. Only the newest one is known
      // here, and the gateway says it does not know rather than inventing one.
      case 'eth_getBlockByHash':
        return null

      case 'eth_getTransactionByHash':
      case 'eth_getTransactionReceipt':
        return null

      default:
        throw Object.assign(new Error(`metodo no soportado por la puerta: ${method}`), { code: -32601 })
    }
  }

  const server = createServer((req, res) => {
    const respond = (status: number, data: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(data))
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    let acc = ''
    req.on('data', (c) => (acc += c))
    req.on('end', async () => {
      try {
        if (path === '/evm/info') {
          respond(200, await info())
          return
        }
        if (path === '/evm/icon.png' || path === '/evm/icon') {
          if (!iconBytes) {
            respond(404, { error: 'icono no disponible: falta media/Mundo-SDLG-256.png' })
            return
          }
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' })
          res.end(iconBytes)
          return
        }
        if (path === '/evm/connect') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(connectHtml(port))
          return
        }
        if (path === '/evm/faucet') {
          const body: Json = acc ? JSON.parse(acc) : {}
          respond(200, await ethFaucet(String(body.address ?? '')))
          return
        }
        if ((path === '/' || path === '') && (req.method === 'GET' || req.method === 'HEAD')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(connectHtml(port))
          return
        }
        if (path === '/' || path === '') {
          const body: Json = acc ? JSON.parse(acc) : {}
          const run = async (obj: Json): Promise<Json> => {
            const id = obj.id ?? null
            const method = String(obj.method ?? '')
            const params = Array.isArray(obj.params) ? obj.params : []
            try {
              return { jsonrpc: '2.0', id, result: await dispatch(method, params as unknown[]) }
            } catch (e) {
              const err = e as Error & { code?: number }
              return { jsonrpc: '2.0', id, error: { code: typeof err.code === 'number' ? err.code : -32000, message: err.message } }
            }
          }
          respond(200, Array.isArray(body) ? await Promise.all(body.map(run)) : await run(body as Json))
          return
        }
        respond(404, { error: 'no encontrado' })
      } catch (e) {
        respond(500, { error: e instanceof Error ? e.message : String(e) })
      }
    })
  })

  server.listen(port)
  log.info(`EVM gateway en http://127.0.0.1:${port} (chainId ${EVM_CHAIN_ID}), leyendo la cadena de ${upstream}`)
  return server
}
