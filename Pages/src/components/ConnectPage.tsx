import { useCallback, useEffect, useState } from 'react';
import { Card, Nav, Notice, PrimaryButton, Row } from './Ui';
import {
  formatPapu,
  getAccount,
  getBlockNumber,
  getPapuBalance,
  getParams,
  getSupply,
  getWalletBalance,
  getWalletChainId,
  hasWallet,
  issuerOf,
  requestAccounts,
  sameChain,
  shortenAddress,
} from '../lib/wallet';
import type { ChainParams, PapuBalance, Supply } from '../lib/wallet';

const ENDPOINT = '/rpc';

type Phase = 'idle' | 'connecting' | 'connected';

export default function ConnectPage() {
  const [walletPresent, setWalletPresent] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [address, setAddress] = useState<string | null>(null);
  const [walletChain, setWalletChain] = useState<string | null>(null);
  const [balance, setBalance] = useState<PapuBalance | null>(null);
  const [supply, setSupply] = useState<Supply | null>(null);
  const [params, setParams] = useState<ChainParams | null>(null);
  const [block, setBlock] = useState<string | null>(null);
  const [nodeUp, setNodeUp] = useState<boolean | null>(null);
  const [native, setNative] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readNode = useCallback(async (addr: string | null) => {
    try {
      const [p, s, b] = await Promise.all([
        getParams(ENDPOINT),
        getSupply(ENDPOINT),
        getBlockNumber(ENDPOINT),
      ]);
      setParams(p);
      setSupply(s);
      setBlock(b);
      setNodeUp(true);
      setError(null);
      if (addr) {
        const bal = await getPapuBalance(ENDPOINT, addr);
        setBalance(bal);
      }
    } catch (err) {
      setNodeUp(false);
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    setWalletPresent(hasWallet());
    // Si ya hay una cuenta autorizada, no hay que pedirla otra vez.
    getAccount().then((acc) => {
      if (acc) {
        setAddress(acc);
        setPhase('connected');
        readNode(acc);
        getWalletChainId().then(setWalletChain);
      }
    });
    readNode(null);
    const id = setInterval(() => readNode(address), 4000);
    return () => clearInterval(id);
  }, [readNode, address]);

  async function connect() {
    setError(null);
    setPhase('connecting');
    const acc = await requestAccounts();
    if (!acc) {
      setPhase('idle');
      setError('No se concedio acceso a la cuenta, o no hay ninguna wallet instalada.');
      return;
    }
    setAddress(acc);
    setPhase('connected');
    setWalletChain(await getWalletChainId());
    setNative(await getWalletBalance(acc));
    await readNode(acc);
  }

  function disconnect() {
    setAddress(null);
    setPhase('idle');
    setBalance(null);
    setNative(null);
    setWalletChain(null);
  }

  const nodeChainId = params?.evm?.chainId ?? null;
  const chainMatches = sameChain(walletChain, nodeChainId);

  return (
    <div className="shell">
      <Nav current="connect" />

      <div className="headline">
        <h1>Conectar la wallet</h1>
        <span className="sub">
          {params ? `${params.evm.name} · chainId ${nodeChainId} · ${params.symbol}` : 'esperando al nodo'}
        </span>
      </div>

      {nodeUp === false && (
        <Notice kind="warn">
          El nodo no responde en {ENDPOINT}. Los datos de la cadena apareceran cuando
          este encendido.
        </Notice>
      )}

      <div className="grid grid-2" style={{ marginTop: nodeUp === false ? 16 : 0 }}>
        <Card title="Wallet" note={walletPresent === null ? '...' : walletPresent ? 'detectada' : 'no detectada'}>
          {walletPresent === false ? (
            <div className="empty">
              No hay ninguna wallet en este navegador.
              <br />
              Instala MetaMask u otra wallet compatible para conectarte.
            </div>
          ) : phase === 'connected' && address ? (
            <>
              <div className="metric-label">Cuenta conectada</div>
              <div className="metric-value sm" title={address}>
                {shortenAddress(address, 12, 8)}
              </div>
              <div className="metric-foot">{address}</div>
              <div className="controls" style={{ marginTop: 18 }}>
                <button className="btn" onClick={disconnect}>
                  Desconectar
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--grey)', fontSize: 13, marginTop: 0 }}>
                Al conectar, MetaMask te pedira permiso para compartir una direccion.
                El nodo solo necesita la direccion para leer tu saldo: las
                transacciones las firma tu wallet.
              </p>
              <PrimaryButton onClick={connect} disabled={phase === 'connecting'}>
                {phase === 'connecting' ? 'Conectando...' : 'Conectar MetaMask'}
              </PrimaryButton>
            </>
          )}

          {error && (
            <div style={{ marginTop: 16 }}>
              <Notice kind="warn">{error}</Notice>
            </div>
          )}
        </Card>

        <Card title="Estado de la conexion" note="lo que la wallet cree y lo que es el nodo">
          <table className="table">
            <tbody>
              <Row k="wallet en la cadena" v={walletChain ? `${walletChain} (${Number(walletChain)})` : '—'} />
              <Row
                k="cadena del nodo"
                v={nodeChainId !== null ? `${nodeChainId}` : '—'}
              />
              <Row
                k="coinciden"
                v={phase === 'connected' ? (chainMatches ? 'si' : 'no') : '—'}
              />
              <Row k="saldo nativo" v={native ?? '—'} />
              <Row k="saldo PAPU" v={balance ? formatPapu(balance.raw) : '—'} />
              <Row k="altura" v={block ? String(Number(block)) : '—'} />
            </tbody>
          </table>

          {phase === 'connected' && !chainMatches && (
            <div style={{ marginTop: 14 }}>
              <Notice kind="warn">
                MetaMask esta en la cadena {walletChain} y el nodo declara {nodeChainId}.
                La lectura del saldo sigue funcionando porque va por el RPC, pero una
                transaccion desde la wallet apuntaria a otra red.
              </Notice>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Tu cuenta en la cadena" note="leido del nodo, no de la wallet">
          {balance ? (
            <table className="table">
              <tbody>
                <Row k="direccion" v={balance.address} hash />
                <Row k="saldo" v={`${formatPapu(balance.raw)} ${params?.symbol ?? ''}`} />
                <Row k="raw" v={balance.raw} hash />
                <Row k="decimales" v={String(balance.decimals)} />
                <Row k="nonce" v={String(balance.nonce)} />
              </tbody>
            </table>
          ) : (
            <div className="empty">
              {phase === 'connected'
                ? 'Esta cuenta no tiene saldo registrado, o el nodo no responde.'
                : 'Conecta una wallet para ver el saldo.'}
            </div>
          )}
        </Card>

        <Card title="Red" note="lo que declara la cadena">
          {params ? (
            <table className="table">
              <tbody>
                <Row k="nombre" v={params.evm.name} />
                <Row k="simbolo" v={params.evm.symbol} />
                <Row k="network" v={params.network} />
                <Row k="chainId" v={String(params.evm.chainId)} />
                <Row k="servicio" v={params.serviceName} />
                <Row k="serviceId" v={String(params.serviceId)} />
                <Row k="decimales EVM" v={String(params.evm.decimals)} />
                <Row k="emisor" v={issuerOf(params) ?? '—'} hash />
                <Row
                  k="grifo"
                  v={params.bridgeAddress ? params.bridgeAddress : 'sin cuenta puente (no puede emitir)'}
                  hash
                />
                <Row k="oferta total" v={supply ? `${formatPapu(supply.raw)} ${params.symbol}` : '—'} />
              </tbody>
            </table>
          ) : (
            <div className="empty">Sin datos del nodo.</div>
          )}
        </Card>
      </div>

      <Card title="Como encaja esto con el nodo" note="para que no haya sorpresas">
        <p style={{ color: 'var(--grey)', fontSize: 13, marginTop: 0, maxWidth: 760 }}>
          El nodo expone un RPC con forma Polkadot y una capa de compatibilidad EVM.
          Ahi estan <span className="tag tag-red">eth_chainId</span>,{' '}
          <span className="tag tag-red">eth_blockNumber</span> y{' '}
          <span className="tag tag-red">eth_getBalance</span>, que son los que MetaMask
          necesita para arrancar. Lo que no hace todavia es atender
          <span className="tag tag-red"> ethereum_requestAccounts</span>: la wallet
          entrega la direccion, y a partir de ahi el saldo y la cadena se leen por el
          RPC. Por eso conectar aqui es de verdad solo lectura, y esta escrito en la
          pagina en vez de disimularlo.
        </p>
        <p style={{ color: 'var(--grey)', fontSize: 13, maxWidth: 760 }}>
          Las transacciones hay que hacerlas todavia a mano; cuando el nodo atienda los
          mismos metodos, esta pagina banquera con anadir el boton de firma.
        </p>
      </Card>

      <div className="foot">
        <span>MUNDO SDLG · conectar · lectura de saldo por RPC, firma en la wallet</span>
        <span>
          {params ? `${params.symbol} en ${params.evm.name}` : 'sin nodo'}
        </span>
      </div>
    </div>
  );
}
