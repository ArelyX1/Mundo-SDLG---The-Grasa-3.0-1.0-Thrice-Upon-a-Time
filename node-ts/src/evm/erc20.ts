import { checksumAddress, keccak } from './evm.js'
import { bytesToHex } from '../core/crypto.js'

/**
 * Facade ERC-20 de PAPU (la moneda nativa vista como token).
 * SDLG-JAM no tiene contratos: este facade responde a las llamadas que usa
 * MetaMask para validar y mostrar un token (wallet_watchAsset): name, symbol,
 * decimals, totalSupply, balanceOf y allowance. balanceOf = saldo nativo en
 * wei (18 decimales), igual que eth_getBalance.
 */

export const PAPU_TOKEN = {
  name: 'CRYPTOPAPU',
  symbol: 'PAPU',
  decimals: 18,
} as const

/** Direccion deterministica del "contrato": keccak('Mundo SDLG CRYPTOPAPU') ~> ultimos 20 bytes (EIP-55). */
export const PAPU_TOKEN_ADDRESS = checksumAddress('0x' + bytesToHex(keccak(new TextEncoder().encode('Mundo SDLG CRYPTOPAPU')).subarray(-20)))

const selector = (sig: string): string => '0x' + bytesToHex(keccak(new TextEncoder().encode(sig))).slice(0, 8)

export const SELECTORS = {
  name: selector('name()'),
  symbol: selector('symbol()'),
  decimals: selector('decimals()'),
  totalSupply: selector('totalSupply()'),
  balanceOf: selector('balanceOf(address)'),
  allowance: selector('allowance(address,address)'),
  transfer: selector('transfer(address,uint256)'),
  approve: selector('approve(address,uint256)'),
  transferFrom: selector('transferFrom(address,address,uint256)'),
} as const

const uint256 = (n: bigint): string => '0x' + n.toString(16).padStart(64, '0')

/** Encodifica un string como retorno ABI (string): offset 0x20 + length + contenido padded a 32. */
export function abiString(value: string): string {
  const bytes = new TextEncoder().encode(value)
  const pad = (bytes.length + 31) & ~31
  const data = new Uint8Array(pad)
  data.set(bytes)
  return '0x' + uint256(32n).slice(2) + uint256(BigInt(bytes.length)).slice(2) + bytesToHex(data)
}

/** Responde una llamada eth_call al facade ERC-20; devuelve '0x' si no aplica. */
export function erc20Call(data: string, balanceOf: (address: string) => bigint, totalSupply?: () => bigint): string {
  const calldata = data.startsWith('0x') ? data.slice(2) : data
  const sel = calldata.slice(0, 8) || '0'
  const arg = calldata.slice(8)
  switch (sel.toLowerCase()) {
    case SELECTORS.name.slice(2):
      return abiString(PAPU_TOKEN.name)
    case SELECTORS.symbol.slice(2):
      return abiString(PAPU_TOKEN.symbol)
    case SELECTORS.decimals.slice(2):
      return uint256(BigInt(PAPU_TOKEN.decimals))
    case SELECTORS.totalSupply.slice(2):
      return uint256(totalSupply ? totalSupply() : 0n)
    case SELECTORS.balanceOf.slice(2):
      return uint256(balanceOf(('0x' + arg.slice(24, 64)).toLowerCase()))
    case SELECTORS.allowance.slice(2):
      return uint256(0n)
    default:
      return '0x'
  }
}

/** Codigo minimo para eth_getCode: algo no vacio para que no parezca EOA. */
export const PAPU_TOKEN_CODE = '0x600160016000f3'