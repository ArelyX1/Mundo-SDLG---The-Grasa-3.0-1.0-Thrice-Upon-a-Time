import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, LogList, Metric, Nav, StateFlag } from './Ui';
import {
  BlockHeightChart,
  LatencyChart,
  LatencyScatter,
  MetricBars,
  QueuePie,
  SlotEpochChart,
  Sparkline,
  StateRadar,
  StorageChart,
  SupplyChart,
  UptimeStack,
} from './Charts';
import { DEFAULT_ENDPOINT, formatNumber, formatPapu, formatUptime } from '../lib/rpc';
import { stallSeconds, uptimeRatio, useNetworkProbe } from '../lib/useNetworkProbe';
import type { Sample } from '../lib/types';

const MAX_LOG = 80;

export default function HealthPanel() {
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [draft, setDraft] = useState(DEFAULT_ENDPOINT);
  const [logs, setLogs] = useState<{ at: number; text: string; kind: 'ok' | 'err' }[]>([]);

  const { snap, samples, poll, endpoint: active, changeEndpoint } = useNetworkProbe(endpoint);

  // El tiempo en pantalla depende del reloj del navegador, así que hay que
  // forzar un repintado aunque el RPC no haya dicho nada nuevo.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const lastOnline = useRef<number | null>(null);
  const lastBlock = useRef<number | null>(null);
  const lastErrorKey = useRef<string>('');
  const dropped = useRef(0);

  // Solo se anota lo que cambia. Anotar cada sondeo metia una linea cada dos
  // segundos aunque no pasara nada, y el registro llenaba su altura enseguida:
  // no crecia la caja, se llenaba de ruido.
  useEffect(() => {
    if (!snap) return;
    const at = Date.now();

    if (snap.state === 'online') {
      if (lastOnline.current === null) {
        lastOnline.current = at;
        pushLog('nodo alcanzable por RPC', 'ok');
      }
      if (snap.blockNumber !== null && snap.blockNumber !== lastBlock.current) {
        lastBlock.current = snap.blockNumber;
        pushLog(`bloque ${snap.blockNumber} · slot ${snap.jamHeader?.timeSlotIndex ?? '—'}`, 'ok');
      }
    } else if (lastOnline.current !== null) {
      lastOnline.current = null;
      lastBlock.current = null;
      pushLog('nodo sin respuesta: ' + (snap.errors[0] ?? 'inaccesible'), 'err');
    }

    // Los errores se agrupan: si los mismos tres se repiten cada dos segundos,
    // se anotan una vez y se actualiza el contador.
    const key = snap.errors.join('|');
    if (snap.reachable && key !== lastErrorKey.current) {
      lastErrorKey.current = key;
      if (key) snap.errors.forEach((e) => pushLog(e, 'err'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.reachable, snap?.blockNumber, snap?.state, snap?.errors?.join('|')]);

  function pushLog(text: string, kind: 'ok' | 'err') {
    setLogs((prev) => {
      // Si la ultima linea es identica, solo se refresca su hora en vez de
      // apilar una copia.
      if (prev[0] && prev[0].text === text) return prev;
      dropped.current += 1;
      return [{ at: Date.now(), text, kind }, ...prev].slice(0, MAX_LOG);
    });
  }

  const chart = useMemo(() => {
    const fmt = (t: number) =>
      new Date(t).toLocaleTimeString('es', { hour12: false, minute: '2-digit', second: '2-digit' });
    return {
      latency: samples.map((s: Sample) => ({ t: fmt(s.t), latency: s.latencyMs })),
      height: samples.map((s: Sample) => ({ t: fmt(s.t), height: s.blockNumber })),
      supply: samples.map((s: Sample) => ({ t: fmt(s.t), supply: s.supply })),
      storage: samples.map((s: Sample) => ({
        t: fmt(s.t),
        items: s.storageItems,
        octets: s.storageOctets,
      })),
      slots: samples.map((s: Sample) => ({ t: fmt(s.t), slot: s.timeSlot, epoch: s.epoch })),
      scatter: samples
        .filter((s: Sample) => s.blockNumber !== null && s.latencyMs !== null)
        .map((s: Sample) => ({ block: s.blockNumber as number, latency: s.latencyMs as number })),
      uptime: samples.map((s: Sample) => ({
        t: fmt(s.t),
        ok: s.reachable ? 1 : 0,
        ko: s.reachable ? 0 : 1,
      })),
    };
  }, [samples]);

  const snapUp = uptimeRatio(samples);
  const stalled = stallSeconds(samples);
  const state = snap?.state ?? 'offline';
  const supplyMax = snap?.supply?.maxSupply ? Number(snap.supply.maxSupply) : null;

  const radar = {
    bloques: snap?.blockNumber ?? 0,
    pares: snap?.health?.peers ?? 0,
    pending: snap?.params?.queue?.pending ?? 0,
    entradas: snap?.supply?.storageItems ?? 0,
    extrinsics: snap?.jamHeader?.extrinsics ?? 0,
  };

  const metrics = [
    { label: 'latencia', value: snap?.latencyMs !== null && snap?.latencyMs !== undefined ? `${snap.latencyMs} ms` : '—' },
    { label: 'oferta', value: formatPapu(snap?.supply?.raw ?? null) },
    { label: 'entradas', value: formatNumber(snap?.supply?.storageItems ?? null) },
    { label: 'bytes', value: formatNumber(snap?.supply?.storageOctets ?? null) },
    { label: 'slot', value: formatNumber(snap?.jamHeader?.timeSlotIndex ?? null) },
    { label: 'epoch', value: formatNumber(snap?.jamHeader?.epoch ?? null) },
  ];

  return (
    <div className="shell">
      <Nav current="health" />

      <div className="headline">
        <h1>Salud de la red</h1>
        <span className="sub">
          {snap?.chainName ?? 'sin cadena'} · {snap?.version ?? '—'} · sondeo cada 2s
        </span>
      </div>

      {snap && !snap.reachable && (
        <div className="err-banner">
          El nodo no responde en {active}. Puede estar apagado o arrancando. El panel
          reintenta solo.
        </div>
      )}

      <div className="grid grid-4">
        <section className="card">
          <div className="metric-label">Estado</div>
          <div style={{ paddingTop: 6 }}>
            <StateFlag state={state} />
          </div>
          <div className="metric-foot">
            {snap?.reachable
              ? `sondeos correctos ${(snapUp * 100).toFixed(1)}%`
              : 'endpoint ' + active}
          </div>
        </section>

        <Metric
          label="Tiempo encendido"
          value={snap?.uptime ? formatUptime(snap.uptime.ms) : '—'}
          foot={
            snap?.uptime
              ? `nodo desde ${new Date(snap.uptime.startedAt).toLocaleTimeString('es', { hour12: false })}`
              : 'el nodo no informa de su arranque'
          }
          small
        />

        <Metric
          label="Altura de bloque"
          value={formatNumber(snap?.blockNumber ?? null)}
          foot={stalled > 0 ? `sin avanzar ${stalled}s` : 'avanzando'}
          small
        />

        <Metric
          label="Peers conectados"
          value={formatNumber(snap?.health?.peers ?? null)}
          foot={snap?.health?.shouldHavePeers ? 'deberia tener pares' : 'red sin pares, es lo normal en dev'}
          small
        />
      </div>

      <div className="grid grid-3">
        <Card title="Latencia del RPC" note="cada sondeo">
          <LatencyChart data={chart.latency} />
        </Card>

        <Card title="Altura de bloque" note="si se aplana, la cadena esta parada">
          <BlockHeightChart data={chart.height} />
        </Card>

        <Card title="Disponibilidad" note="verde responde, oscuro falla">
          <UptimeStack data={chart.uptime} />
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="Oferta PAPU" note={`maximo ${supplyMax ? supplyMax.toLocaleString('es') : '—'}`}>
          <SupplyChart data={chart.supply} maxSupply={supplyMax} />
        </Card>

        <Card title="Almacenamiento" note="entradas y bytes">
          <StorageChart data={chart.storage} />
        </Card>

        <Card title="Slots y epochs" note="escala separada">
          <SlotEpochChart data={chart.slots} />
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="Perfil del nodo" note="forma relativa, no suma">
          <StateRadar snapshot={radar} />
        </Card>

        <Card title="Cola de trabajo" note="pendiente frente a huecos">
          <QueuePie pending={snap?.params?.queue?.pending ?? null} slots={snap?.params?.queue?.slots ?? null} />
        </Card>

        <Card title="Latencia por bloque" note="cada punto es un sondeo">
          <LatencyScatter data={chart.scatter} />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Identidad de la cadena">
          <table className="table">
            <tbody>
              <Row k="nombre" v={snap?.chainName ?? '—'} />
              <Row k="version" v={snap?.version ?? '—'} />
              <Row k="nodo" v={snap?.nodeName ?? '—'} />
              <Row k="red" v={snap?.params?.network ?? '—'} />
              <Row k="moneda" v={snap?.params?.symbol ?? '—'} />
              <Row k="servicio" v={snap?.params?.serviceName ?? '—'} />
              <Row k="decimales" v={formatNumber(snap?.params?.decimals ?? null)} />
              <Row k="chainId EVM" v={snap?.chainId ? `${snap.chainId} (${Number(snap.chainId)})` : '—'} />
              <Row k="emisor" v={snap?.params?.issuer ?? '—'} hash />
              <Row k="spec" v={snap?.runtime ? `${snap.runtime.specName} v${snap.runtime.specVersion}` : '—'} />
              <Row k="sincronizando" v={snap?.health?.isSyncing ? 'si' : 'no'} />
            </tbody>
          </table>
        </Card>

        <Card title="Ultimo bloque" note="lo que el nodo tiene como finalizar">
          <table className="table">
            <tbody>
              <Row k="numero" v={formatNumber(snap?.blockNumber ?? null)} />
              <Row k="autor" v={formatNumber(snap?.jamHeader?.blockAuthorIndex ?? null)} />
              <Row k="slot" v={formatNumber(snap?.jamHeader?.timeSlotIndex ?? null)} />
              <Row k="epoch" v={formatNumber(snap?.jamHeader?.epoch ?? null)} />
              <Row k="extrinsics" v={formatNumber(snap?.jamHeader?.extrinsics ?? null)} />
              <Row k="hash" v={snap?.jamHeader?.hash ?? snap?.latestHash ?? '—'} hash />
              <Row k="estado anterior" v={snap?.chainHeader?.stateRoot ?? '—'} hash />
              <Row k="estado resultante" v={snap?.jamHeader?.resultingStateRoot ?? '—'} hash />
              <Row k="comision" v={snap?.supply?.transferFee ?? '—'} />
              <Row k="direcciones" v={snap?.listenAddresses?.length ? snap.listenAddresses.join(', ') : 'ninguna anunciada'} />
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Series" note="comparativa rapida">
          <MetricBars data={metrics.map((m) => ({ label: m.label, value: Number(String(m.value).replace(/[^\d.-]/g, '')) || 0 }))} />
        </Card>

        <Card title="Tendencias" note="ultimas muestras">
          <div className="grid grid-2" style={{ marginBottom: 0 }}>
            <MiniTrend title="bloque" data={samples as unknown as Record<string, number | null>[]} keyName="blockNumber" />
            <MiniTrend title="oferta" data={samples as unknown as Record<string, number | null>[]} keyName="supplyRaw" />
            <MiniTrend title="bytes" data={samples as unknown as Record<string, number | null>[]} keyName="storageOctets" />
            <MiniTrend title="latencia" data={samples as unknown as Record<string, number | null>[]} keyName="latencyMs" />
          </div>
        </Card>
      </div>

      <Card title="Registro del panel" note="lo que va viendo, no el log del nodo">
        <LogList rows={logs} />
      </Card>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="Endpoint del RPC" note="por defecto pasa por el proxy local">
          <div className="controls">
            <input
              className="field"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="http://127.0.0.1:9944"
              spellCheck={false}
            />
            <button className="btn" onClick={() => changeEndpoint(draft || DEFAULT_ENDPOINT)}>
              Aplicar
            </button>
            <button className="btn" onClick={() => { poll(); setDraft(active); }} disabled={!snap?.reachable}>
              Sondear ahora
            </button>
          </div>
        </Card>

        <Card title="Diagnostico" note="lo que el RPC respondio o dejo de responder">
          <table className="table">
            <tbody>
              <Row k="estado" v={state} />
              <Row k="endpoint" v={active} />
              <Row k="latencia" v={snap?.latencyMs != null ? `${snap.latencyMs} ms` : '—'} />
              <Row k="sondeos" v={String(samples.length)} />
              <Row k="errores" v={snap?.errors.length ? String(snap.errors.length) : 'ninguno'} />
              <Row k="detalle" v={snap?.errors.length ? snap.errors.join(' | ') : 'todas las consultas respondieron'} />
            </tbody>
          </table>
        </Card>
      </div>

      <div className="foot">
        <span>MUNDO SDLG · panel de salud · datos leidos del RPC del nodo, sin valores de ejemplo</span>
        <span>Timeslot {formatNumber(snap?.jamHeader?.timeSlotIndex ?? null)} · altura {formatNumber(snap?.blockNumber ?? null)}</span>
      </div>
    </div>
  );
}

function Row({ k, v, hash }: { k: string; v: string; hash?: boolean }) {
  return (
    <tr>
      <th style={{ borderBottom: '1px solid var(--bg-sunken)' }}>{k}</th>
      <td className={hash ? 'hash' : undefined}>{v}</td>
    </tr>
  );
}

function MiniTrend({
  title,
  data,
  keyName,
}: {
  title: string;
  data: Record<string, number | null>[];
  keyName: string;
}) {
  return (
    <div>
      <div className="metric-label" style={{ marginBottom: 2 }}>
        {title}
      </div>
      <Sparkline data={data} dataKey={keyName} />
    </div>
  );
}
