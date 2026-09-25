import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { JamNode } from '../engine.js'
import type { WalletStore } from '../wallet.js'
import type { Logger } from '../core/log.js'
import { buildWorkItem, PAPUCOIN } from '../services/papucoin/service.js'
import {
  EVM_CHAIN_ID,
  EVM_CHAIN_NAME,
  EVM_GAS,
  isEvmAddress,
  normalizeEvmAddress,
  parseEvmTx,
  weiToRaw,
  rawToWei,
  keccakHex,
} from '../evm/evm.js'
import { hexToBytes } from '../core/crypto.js'
import { networkEpochStart } from '../genesis.js'
import { PAPU_TOKEN, PAPU_TOKEN_ADDRESS, PAPU_TOKEN_CODE, erc20Call } from '../evm/erc20.js'

type Json = Record<string, unknown>

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
  const tokenIcon = tokenImageUrl()
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
<p>Conecta MetaMask con <b>CRYPTOPAPU (PAPU)</b> en la red local <code>Mundo SDLG</code> (chainId <code>5120</code>, sin contratos: solo transferencias PAPU).</p>
<div>
<button onclick="connectAndWelcome()">Agregar red y conectar (5 PAPU de bienvenida)</button>
</div>
<p style="font-size:12px;color:#95a5a6">Token PAPU: <code>${PAPU_TOKEN_ADDRESS}</code> — si el agregado automatico falla, importalo a mano en MetaMask con esa direccion (simbolo PAPU, 18 decimales).</p>
<pre id="log">Esperando...</pre>
<script>
const RPC=location.origin;
const SYMBOL='PAPU';
const TOKEN_ADDRESS='${PAPU_TOKEN_ADDRESS}';
const TOKEN_ICON='${tokenIcon}';
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
      chainId:'0x1400', chainName:'Mundo SDLG',
      nativeCurrency:{name:'CRYPTOPAPU',symbol:'PAPU',decimals:18},
      rpcUrls:[RPC],
      iconUrls:['${icon}', RPC+'/evm/icon.png']
    }]});
    await eth.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1400'}]});
    log('Red Mundo SDLG agregada y conectada.');
  }catch(e){log('Error: '+e.message,'err');}
}
async function addToken(){
  const eth=window.ethereum;
  let acc;
  try{ acc=await activeAccount(); }catch(e){ log('No se pudo conectar la cuenta: '+e.message,'err'); return; }
  if(!acc){ log('Sin cuenta activa para agregar el token.','err'); return; }
  // Espera a que MetaMask termine de cambiar/asentar a la red local: encadenar
  // watchAsset inmediatamente detras del switch rompe la llamada (bug interno MM).
  await new Promise(r=>setTimeout(r,1200));
  let rejected=false;
  for(let attempt=0;attempt<3;attempt++){
    if(attempt) await new Promise(r=>setTimeout(r,1500));
    try{
      const ok=await eth.request({method:'wallet_watchAsset',params:[{type:'ERC20',options:{
        address:TOKEN_ADDRESS, symbol:SYMBOL, decimals:18, image:TOKEN_ICON
      }}]});
      if(ok){ log('Conectado con exito. Token '+SYMBOL+' agregado con logo.'); return; }
    }catch(e){
      // si el usuario rechazo la ventana, no re-preguntar 3 veces
      if(e?.code===4001||(/rejected|cancel/i.test(e?.message||''))) rejected=true;
      if(rejected) break;
    }
  }
  log('Conectado con exito.');
}
async function claimWelcome(addr){
  if(!addr) return;
  try{
    const r=await fetch(RPC+'/evm/welcome',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({address:addr})});
    const j=await r.json();
    if(j.accepted){
      log('Bienvenida: +'+j.amount+' '+SYMBOL+' para '+addr.slice(0,6)+'\\u2026'+addr.slice(-4)+'.');
    }else if(j.claimed){
      log('Cuenta ya registrada: la bienvenida se da una sola vez por wallet.');
    }else{
      log('Bienvenida: '+(j.error||'error'),'err');
    }
  }catch{}
}
async function connectAndWelcome(){
  await addNet();
  const acc=await activeAccount();
  await claimWelcome(acc);
  await addToken();
}
window.ethereum?.on?.('accountsChanged',(a)=>claimWelcome(a?.[0]));
</script>
</body></html>`
}

interface Pending {
  txHash: string
  itemId: string
  from: string
  to: string
  valueWei: bigint
  evmNonce: number
}

const toQ = (n: bigint | number): string => '0x' + BigInt(n).toString(16)

export function createEvmServer(node: JamNode, walletStore: WalletStore, log: Logger, port: number): Server {
  let bridge = walletStore.get('bridge')
  if (!bridge) {
    try {
      bridge = walletStore.create('bridge')
      log.warn('wallet bridge (relay EVM) no existia; la cree en wallets/bridge.json')
    } catch {
      throw new Error('no existe wallets/bridge.json (relay EVM). Generala con: npm run dev -- keygen --name bridge --out ./wallets')
    }
  }

  const pending = new Map<string, Pending>()

  const settled = (itemId: string): { slot: number; ok: boolean } | undefined => {
    for (const e of node.eventsLatest(512)) if (e.itemId === itemId) return { slot: e.slot, ok: e.ok }
    return undefined
  }

  const submit = (item: ReturnType<typeof buildWorkItem>): void => {
    const r = node.submitWorkItem(item, true)
    if (!r.accepted) throw new Error(r.reason ?? 'item rechazado')
  }

  const ethSendRaw = (rawHex: string): string => {
    const parsed = parseEvmTx(rawHex)
    if (parsed.data) throw new Error('tx con data/contratos no soportado')
    const from = normalizeEvmAddress(parsed.from)
    const to = normalizeEvmAddress(parsed.to)
    const amountRaw = weiToRaw(parsed.value)
    const fee = BigInt(PAPUCOIN.transferFee)
    if (node.balanceOf(from) < amountRaw + fee) throw new Error('insufficient funds for action')
    const expected = node.evmNonceOf(from)
    if (parsed.nonce !== expected) throw new Error(`nonce incorrecto: esperado ${expected}, recibido ${parsed.nonce}`)
    const item = buildWorkItem(
      bridge.secretKey,
      bridge.address,
      'transfer',
      { to, amount: amountRaw.toString(), from: parsed.from, evmNonce: Number(parsed.nonce), raw: rawHex },
      Number(node.nonceOf(bridge.address)),
      `evm ${parsed.txHash.slice(0, 10)}`,
    )
    submit(item)
    pending.set(parsed.txHash, { txHash: parsed.txHash, itemId: item.id, from, to, valueWei: parsed.value, evmNonce: Number(parsed.nonce) })
    return parsed.txHash
  }

  const ethFaucet = (address: string): Json => {
    if (!isEvmAddress(address)) return { accepted: false, error: 'direccion 0x invalida', to: address }
    if (node.faucetClaimed(address)) return { accepted: false, error: 'faucet ya reclamado para esta direccion', to: address }
    const item = buildWorkItem(bridge.secretKey, bridge.address, 'faucet', { to: normalizeEvmAddress(address) }, Number(node.nonceOf(bridge.address)), 'evm faucet')
    submit(item)
    return { accepted: true, itemId: item.id, to: normalizeEvmAddress(address), amountRaw: PAPUCOIN.faucetAmount.toString(), amount: '10000' }
  }

  const ethWelcome = (address: string): Json => {
    if (!isEvmAddress(address)) return { accepted: false, error: 'direccion 0x invalida', to: address }
    if (node.welcomeClaimed(address)) return { accepted: false, claimed: true, error: 'bienvenida ya otorgada (una sola vez por wallet)', to: address }
    const item = buildWorkItem(bridge.secretKey, bridge.address, 'welcome', { to: normalizeEvmAddress(address) }, Number(node.nonceOf(bridge.address)), 'evm welcome')
    submit(item)
    return { accepted: true, itemId: item.id, to: normalizeEvmAddress(address), amountRaw: PAPUCOIN.welcomeAmount.toString(), amount: String(PAPUCOIN.welcomeAmount / 10n ** 12n) }
  }

  const blockObj = (slot: number): Json => ({
    number: toQ(slot),
    hash: '0x' + node.head.hash,
    parentHash: '0x' + node.head.header.parentHash,
    timestamp: toQ(Math.floor(networkEpochStart(node.genesis) / 1000) + slot * node.genesis.timeslotSecs),
    miner: '0x' + '00'.repeat(20),
    gasLimit: toQ(30_000_000),
    gasUsed: toQ(0),
    baseFeePerGas: toQ(1),
    transactions: [],
  })

  const blockNumberFromTag = (tag: string): number => {
    if (['latest', 'pending', 'safe', 'finalized'].includes(tag)) return node.head.header.timeslot
    return Number(BigInt(tag))
  }

  const dispatch = async (method: string, params: unknown[]): Promise<unknown> => {
    const [p0, p1] = params as [unknown, unknown]
    switch (method) {
      case 'web3_clientVersion':
        return 'sdlg-jam-evm/0.1.0'

      case 'web3_sha3': {
        const data = String(p0 ?? '')
        return '0x' + keccakHex(hexToBytes(data.startsWith('0x') ? data.slice(2) : data))
      }

      case 'net_version':
        return String(EVM_CHAIN_ID)

      case 'net_listening':
        return true

      case 'net_peerCount':
        return toQ(node.peerCount())

      case 'eth_chainId':
        return toQ(EVM_CHAIN_ID)

      case 'eth_protocolVersion':
        return '0x41'

      case 'eth_blockNumber':
        return toQ(node.head.header.timeslot)

      case 'eth_getBalance': {
        if (typeof p0 !== 'string' || !isEvmAddress(p0)) throw new Error('address invalida')
        return toQ(rawToWei(node.balanceOf(normalizeEvmAddress(p0))))
      }

      case 'eth_getTransactionCount': {
        if (typeof p0 !== 'string' || !isEvmAddress(p0)) throw new Error('address invalida')
        return toQ(node.evmNonceOf(normalizeEvmAddress(p0)))
      }

      case 'eth_getCode':
        if (normalizeEvmAddress(String(p0 ?? '')) === normalizeEvmAddress(PAPU_TOKEN_ADDRESS)) return PAPU_TOKEN_CODE
        return '0x'

      case 'eth_getStorageAt':
        return '0x'

      case 'eth_accounts':
        return []

      case 'eth_syncing':
        return false

      case 'eth_gasPrice':
        return toQ(BigInt(PAPUCOIN.transferFee))

      case 'eth_maxPriorityFeePerGas':
        return toQ(0)

      case 'eth_feeHistory': {
        const count = Math.min(Number(p0 ?? 1) || 1, 1024)
        const oldest = Math.max(0, node.head.header.timeslot - count + 1)
        return { oldestBlock: toQ(oldest), baseFeePerGas: Array.from({ length: count }, () => toQ(1)), gasUsedRatio: Array.from({ length: count }, () => 0), reward: [] }
      }

      case 'eth_estimateGas':
        return toQ(EVM_GAS)

      case 'eth_call': {
        const call = (p0 ?? {}) as { to?: string; data?: string }
        if (normalizeEvmAddress(String(call.to ?? '')) === normalizeEvmAddress(PAPU_TOKEN_ADDRESS)) {
          return erc20Call(String(call.data ?? ''), (addr) => rawToWei(node.balanceOf(addr)))
        }
        return '0x'
      }

      case 'eth_getBlockByNumber': {
        const slot = blockNumberFromTag(String(p0 ?? 'latest'))
        if (slot > node.head.header.timeslot) return null
        return blockObj(slot)
      }

      case 'eth_getBlockByHash':
        return '0x' + node.head.hash === String(p0 ?? '').toLowerCase() ? blockObj(node.head.header.timeslot) : null

      case 'eth_sendRawTransaction': {
        if (typeof p0 !== 'string') throw new Error('raw invalida')
        return ethSendRaw(p0)
      }

      case 'eth_sendTransaction':
        throw new Error('firme desde la wallet: use eth_sendRawTransaction')

      case 'eth_getTransactionByHash': {
        const hash = String(p0 ?? '').toLowerCase()
        const p = pending.get(hash)
        if (!p) return null
        const s = settled(p.itemId)
        return {
          hash,
          from: p.from,
          to: p.to,
          value: toQ(p.valueWei),
          nonce: toQ(p.evmNonce),
          gas: toQ(EVM_GAS),
          gasPrice: toQ(BigInt(PAPUCOIN.transferFee)),
          input: '0x',
          blockNumber: s ? toQ(s.slot) : null,
          blockHash: s ? '0x' + node.head.hash : null,
          transactionIndex: toQ(0),
          v: '0x0',
          r: '0x0',
          s: '0x0',
        }
      }

      case 'eth_getTransactionReceipt': {
        const hash = String(p0 ?? '').toLowerCase()
        const p = pending.get(hash)
        if (!p) return null
        const s = settled(p.itemId)
        if (!s) return null
        return {
          transactionHash: hash,
          transactionIndex: toQ(0),
          blockNumber: toQ(s.slot),
          blockHash: '0x' + node.head.hash,
          cumulativeGasUsed: toQ(EVM_GAS),
          gasUsed: toQ(EVM_GAS),
          effectiveGasPrice: toQ(BigInt(PAPUCOIN.transferFee)),
          contractAddress: null,
          logs: [],
          status: s.ok ? '0x1' : '0x0',
          from: p.from,
          to: p.to,
        }
      }

      case 'eth_getLogs':
      case 'eth_getFilterChanges':
      case 'eth_getFilterLogs':
        return []

      default:
        throw Object.assign(new Error(`metodo no soportado: ${method}`), { code: -32601 })
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
          respond(200, {
            service: `EVM bridge (${PAPUCOIN.name} / ${PAPUCOIN.symbol})`,
            network: EVM_CHAIN_NAME,
            chainId: EVM_CHAIN_ID,
            symbol: PAPUCOIN.symbol,
            decimals: 12,
            weiScale: 6,
            gas: EVM_GAS.toString(),
            transferFee: PAPUCOIN.transferFee.toString(),
            faucet: 'POST /evm/faucet {"address":"0x..."}',
            welcome: `POST /evm/welcome {"address":"0x..."} (5 ${PAPUCOIN.symbol}, una sola vez por wallet)`,
            icon: iconUrl(port),
            token: { address: PAPU_TOKEN_ADDRESS, name: PAPU_TOKEN.name, symbol: PAPU_TOKEN.symbol, decimals: PAPU_TOKEN.decimals, image: tokenImageUrl() },
            relay: bridge.address,
          })
          return
        }
        if (path === '/evm/icon.png' || path === '/evm/icon') {
          if (!iconBytes) {
            respond(404, { error: 'icono no disponible: falta media/Mundo-SDLG-pacman-256.png' })
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
          respond(200, ethFaucet(String(body.address ?? '')))
          return
        }
        if (path === '/evm/welcome') {
          const body: Json = acc ? JSON.parse(acc) : {}
          respond(200, ethWelcome(String(body.address ?? '')))
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
  log.info(`EVM bridge en http://127.0.0.1:${port} (chainId ${EVM_CHAIN_ID}, relay ${bridge.address.slice(0, 10)}...)`)
  return server
}