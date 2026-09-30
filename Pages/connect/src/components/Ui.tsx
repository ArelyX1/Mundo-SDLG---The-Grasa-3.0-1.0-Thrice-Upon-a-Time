import type { ReactNode } from 'react';

/** Menú superior, el mismo que en el panel de salud. */
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

export function Row({ k, v, hash }: { k: string; v: string; hash?: boolean }) {
  return (
    <tr>
      <th style={{ borderBottom: '1px solid var(--bg-sunken)' }}>{k}</th>
      <td className={hash ? 'hash' : undefined}>{v}</td>
    </tr>
  );
}

/** Botón principal, en carmesí lleno. */
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
