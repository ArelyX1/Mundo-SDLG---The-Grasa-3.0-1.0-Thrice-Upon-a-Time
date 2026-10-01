import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyState, takeSnapshot, toSample } from './rpc';
import type { NetworkSnapshot, Sample } from './types';

const MAX_SAMPLES = 240;

/**
 * Sondea el nodo y guarda el histórico que alimenta los gráficos.
 *
 * El estado apagado/arrancando no lo dice el RPC: cuando no hay nadie
 * escuchando, la llamada falla. Lo que se distingue es cuánto lleva fallando y si
 * alguna vez respondió, que es lo que hace classifyState.
 */
export function useNetworkProbe(endpoint: string, intervalMs = 2000) {
  const [snap, setSnap] = useState<NetworkSnapshot | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [endpointState, setEndpointState] = useState(endpoint);

  const failures = useRef(0);
  const sawOnline = useRef(false);
  const running = useRef(false);

  const poll = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const next = await takeSnapshot(endpointState);
      setSnap(next);

      if (next.reachable) {
        failures.current = 0;
        sawOnline.current = true;
      } else {
        failures.current += 1;
      }

      next.state = classifyState(next, failures.current, sawOnline.current);

      const sample = toSample(next, Date.now());
      setSamples((prev) => {
        const merged = [...prev, sample];
        return merged.length > MAX_SAMPLES ? merged.slice(merged.length - MAX_SAMPLES) : merged;
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [endpointState]);

  useEffect(() => {
    setBusy(true);
    poll();
    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  }, [poll, intervalMs]);

  // Cambiar de endpoint limpia el histórico: mezclar dos redes en un gráfico no
  // significa nada.
  const changeEndpoint = useCallback((next: string) => {
    if (next === endpointState) return;
    setEndpointState(next);
    setSamples([]);
    failures.current = 0;
    sawOnline.current = false;
    setSnap(null);
  }, [endpointState]);

  return { snap, samples, poll, busy, endpoint: endpointState, changeEndpoint };
}

/**
 * Uptime real del panel contra el nodo: la fracción de sondeos que respondieron,
 * sobre el total. Es distinto del uptime del proceso, que el RPC no expone.
 */
export function uptimeRatio(samples: Sample[]): number {
  if (samples.length === 0) return 0;
  const ok = samples.filter((s) => s.reachable).length;
  return ok / samples.length;
}

/**
 * Cuánto tiempo lleva la cadena sin avanzar, leyendo el salto del número de
 * bloque entre muestras consecutivas.
 */
export function stallSeconds(samples: Sample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const prev = [...samples].reverse().find((s) => s.blockNumber !== null);
  if (!prev || last.blockNumber === null || prev.blockNumber === null) return 0;
  if (last.blockNumber > prev.blockNumber) return 0;
  return Math.round((last.t - prev.t) / 1000);
}
