import type { ReactNode } from 'react';

/**
 * Piezas compartidas por las dos paginas. El nav es el mismo en ambas porque
 * ahora viven en el mismo sitio: / es la salud y /connect la wallet, y el
 * operador va de una a otra sin cambiar de proceso.
 */
export function Nav({ current }: { current: 'health' | 'connect' }) {
  return (
    <nav className="nav">
      <a className="nav-brand" href="/">
        MUNDO <span>SDLG</span>
      </a>
      <div className="nav-links">
        <a className="nav-link" href="/" aria-current={current === 'health' ? 'page' : undefined}>
          Salud
        </a>
        <a className="nav-link" href="/connect" aria-current={current === 'connect' ? 'page' : undefined}>
          Conectar
        </a>
      </div>
    </nav>
  );
}

export function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        {note && <span className="card-note">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  foot,
  small,
  dim,
}: {
  label: string;
  value: ReactNode;
  foot?: string;
  small?: boolean;
  dim?: boolean;
}) {
  return (
    <section className="card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value${small ? ' sm' : ''}${dim ? ' dim' : ''}`}>{value}</div>
      {foot && <div className="metric-foot">{foot}</div>}
    </section>
  );
}

export function Row({ k, v, hash }: { k: string; v: string; hash?: boolean }) {
  return (
    <tr>
      <th style={{ borderBottom: '1px solid var(--bg-sunken)' }}>{k}</th>
      <td className={hash ? 'hash' : undefined}>{v}</td>
    </tr>
  );
}

/** Boton principal, en carmesi lleno. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="btn btn-primary" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Notice({ kind, children }: { kind: 'warn' | 'info'; children: ReactNode }) {
  return <div className={kind === 'warn' ? 'err-banner' : 'note-banner'}>{children}</div>;
}

/**
 * El estado del nodo. Encendido, arrancando o apagado; el nodo no reporta esto,
 * se deduce de si el RPC contesta y cuanto lleva sin contestar.
 */
export function StateFlag({ state }: { state: 'online' | 'starting' | 'offline' }) {
  const text = state === 'online' ? 'Encendido' : state === 'starting' ? 'Arrancando' : 'Apagado';
  return (
    <div className={`state state-${state}`}>
      <span className="state-dot" />
      {text}
    </div>
  );
}

export function LogList({
  rows,
  hidden = 0,
}: {
  rows: { at: number; text: string; kind: 'ok' | 'err' }[];
  hidden?: number;
}) {
  if (rows.length === 0) {
    return <div className="empty">Sin registros todavia.</div>;
  }
  return (
    <div className="log-frame">
      <div className="log">
        {rows.map((row, i) => (
          <div className="log-row" key={`${row.at}-${i}`}>
            <span className="log-time">{new Date(row.at).toLocaleTimeString('es', { hour12: false })}</span>
            <span className={row.kind === 'err' ? 'log-err' : 'log-ok'}>{row.text}</span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <div className="log-foot">
          {hidden} entradas mas antiguas quedan fuera de la ventana
        </div>
      )}
    </div>
  );
}
