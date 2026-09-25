import { createInterface } from 'node:readline'
import { RpcClient } from './rpc-client.js'
import { PAPUCOIN, rawToDisplay } from '../services/papucoin/service.js'

interface ConsoleOpts {
  rpc: string
  api: string
}

interface WalletInfo {
  name: string
  address: string
  publicKey: string
}

export async function runConsole(opts: ConsoleOpts): Promise<void> {
  const rpc = new RpcClient(opts.rpc)
  const api = new RpcClient(opts.api)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const prompt = (): void => {
    process.stdout.write('sdlg> ')
  }
  const done = (msg: unknown): void => console.log(JSON.stringify(msg, null, 2))
  const err = (e: unknown): void => console.error(`error: ${e instanceof Error ? e.message : String(e)}`)

  const wallets = async () => api.post<{ wallets: WalletInfo[] }>('economy/wallets', {})
  const resolveAddr = async (a: string): Promise<string> => {
    if (/^sdlg[1-9A-HJ-NP-Za-km-z]{45,60}$/.test(a)) return a
    const { wallets: ws } = await wallets()
    return ws.find((w) => w.name === a)?.address ?? a
  }

  const listWallets = async () => {
    const { wallets: ws } = await wallets()
    const accounts = await rpc.call<Array<{ address: string; kind: 'sdlg' | 'evm'; balanceRaw: string }>>('papucoin_getAccounts')
    const local = new Set(ws.map((w) => w.address))
    const rows: [string, string, string][] = []
    const seen = new Set<string>()
    let totalRaw = 0n
    const add = (name: string, address: string, raw: bigint): void => {
      if (seen.has(address)) return
      seen.add(address)
      totalRaw += raw
      rows.push([name, address, rawToDisplay(raw)])
    }
    for (const w of ws) {
      const b = await rpc.call<{ balanceRaw: string }>('papucoin_getBalance', { address: w.address })
      add(w.name, w.address, BigInt(b.balanceRaw))
    }
    for (const a of accounts) {
      if (!local.has(a.address)) add(a.kind, a.address, BigInt(a.balanceRaw))
    }
    const w = (c: string, n: number, r = false): string => (r ? c.padStart(n) : c.padEnd(n))
    const short = (a: string): string => (a.length > 18 ? a.slice(0, 16) + '…' : a)
    console.log(w('wallet', 12) + '  ' + w('address', 20) + '  ' + w(PAPUCOIN.symbol, 18, true))
    console.log(w('-'.repeat(12), 12) + '  ' + w('-'.repeat(20), 20) + '  ' + w('-'.repeat(18), 18, true))
    for (const [n, a, b] of rows) console.log(w(n, 12) + '  ' + w(short(a), 20) + '  ' + w(b, 18, true))
    console.log(w('total', 12) + '  ' + w(`${rows.length} cuentas`, 20) + '  ' + w(rawToDisplay(totalRaw), 18, true))
  }

  const info = async () => done(await rpc.call('system_health'))
  const network = async () => done(await rpc.call('chain_getHead'))
  const supply = async () => done(await rpc.call('papucoin_getSupply'))
  const balance = async (a: string) => done(await rpc.call('papucoin_getBalance', { address: a }))
  const nonce = async (a: string) => done(await rpc.call('papucoin_getNonce', { address: a }))
  const events = async (n: string) => done(await rpc.call('papucoin_getEvents', { n: n ? Number(n) : 20 }))
  const transfer = async (...w: [string, string, string, string?]) => done(await api.post('economy/transfer', { wallet: w[0], to: w[1], amount: w[2], memo: w[3] }))
  const mint = async (w: string, to: string, amount: string) => done(await api.post('economy/mint', { wallet: w, to, amount }))
  const burn = async (w: string, amount: string) => done(await api.post('economy/burn', { wallet: w, amount }))
  const faucet = async (w: string) => done(await api.post('economy/faucet', { wallet: w }))

  const helpText = [
    `Consola SDLG-JAM (${PAPUCOIN.name}). Escriba "help" para comandos.`,
    '  info                            estado del nodo',
    '  network                         ultimo bloque',
    `  supply                          suministro circulante de ${PAPUCOIN.symbol}`,
    `  wallets                         wallets locales del servidor con su saldo de ${PAPUCOIN.symbol}`,
    '  balance <wallet|addr>           saldo de una wallet o direccion',
    '  nonce <wallet|addr>             nonce de una wallet o direccion',
    '  events [n]                      ultimos movimientos',
    `  transfer <wallet> <to> <amount> [memo]   enviar ${PAPUCOIN.symbol}`,
    `  mint <wallet> <to> <amount>               emitir ${PAPUCOIN.symbol} (solo issuer)`,
    `  burn <wallet> <amount>                    quemar ${PAPUCOIN.symbol}`,
    '  faucet <wallet>                  grifo de prueba',
    '  exit                             salir',
  ].join('\n')

  console.log(helpText)
  prompt()
  rl.on('line', async (lineRaw) => {
    const [cmd, ...rest] = lineRaw.trim().split(/\s+/)
    if (!cmd) {
      prompt()
      return
    }
    if (cmd === 'help') {
      console.log(helpText)
      prompt()
      return
    }
    try {
      switch (cmd) {
        case 'info': await info(); break
        case 'network': await network(); break
        case 'supply': await supply(); break
        case 'wallets': await listWallets(); break
        case 'balance': await balance(await resolveAddr(rest[0] ?? '')); break
        case 'nonce': await nonce(await resolveAddr(rest[0] ?? '')); break
        case 'events': await events(rest[0] ?? '20'); break
        case 'transfer': await transfer(...(rest as [string, string, string, string?])); break
        case 'mint': await mint(rest[0]!, rest[1]!, rest[2]!); break
        case 'burn': await burn(rest[0]!, rest[1]!); break
        case 'faucet': await faucet(rest[0]!); break
        case 'exit':
        case 'quit':
          rl.close()
          return
        default:
          console.log(`comando desconocido: ${cmd} (help para ayuda)`)
      }
    } catch (e) {
      err(e)
    }
    prompt()
  })
  rl.on('close', () => process.exit(0))
}