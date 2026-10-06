import { probeNodes, type NodeProbe } from '../lib/nodes';
import { Card } from './Ui';

export interface NodeSelection {
  nodes: NodeProbe[];
  chosen: string | null;
  onChoose: (id: string) => void;
  busy: boolean;
  source: string;
  scanned: string;
}

/**
 * El selector de nodo.
 *
 * Con un solo nodo vivo esto no aparece: no hay nada que elegir y un selector
 * con una opcion es ruido. Con dos o mas, se listan con su nombre, su altura y
 * si responden, y el que se elige es el que pasan a mirar el resto del panel.
 *
 * Un nodo apagado no se oculta: se ve tachado. La red tolera que cualquier
 * validador caiga y la cadena sigue, pero el operador tiene que ver quien falta.
 */
export default function NodePicker({
  nodes,
  chosen,
  onChoose,
  busy,
  source,
  scanned,
}: NodeSelection) {
  const alive = nodes.filter((n) => n.alive);
  if (nodes.length === 0) {
    return (
      <Card title="Nodos" note="no hay ninguno declarado">
        <div className="empty">
          No hay nodos que mirar.
          <br />
          Declara NODES en el .env, o arranca un nodo en un puerto del rango
          barrido.
        </div>
      </Card>
    );
  }

  if (alive.length <= 1) {
    const only = alive[0];
    return (
      <Card
        title="Nodo"
        note={
          source === 'scan'
            ? `barriendo puertos ${scanned}`
            : `declarados en ${source}`
        }
      >
        {only ? (
          <table className="table">
            <tbody>
              <tr>
                <th>mirable</th>
                <td>
                  <span className="tag tag-red">{only.name ?? 'sin nombre'}</span>{' '}
                  <span style={{ color: 'var(--grey-dim)' }}>{only.url}</span>
                </td>
              </tr>
              <tr>
                <th>cadena</th>
                <td>{only.chain ?? '—'}</td>
              </tr>
              <tr>
                <th>altura</th>
                <td>{only.blockNumber ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="empty">
            Ninguno responde. Se probaron {nodes.length}:{' '}
            {nodes.map((n) => n.url.replace(/^https?:\/\//, '')).join(', ')}.
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card
      title="Nodos"
      note={`${alive.length} de ${nodes.length} responden · elige cual mirar`}
    >
      <div className="nodes">
        {nodes.map((n) => {
          const selected = n.id === chosen;
          const vIdx = n.validatorIndex !== null ? `V${n.validatorIndex}` : `nodo ${n.id}`;
          return (
            <button
              key={n.id}
              className={`node${selected ? ' node-on' : ''}${n.alive ? '' : ' node-off'}`}
              onClick={() => onChoose(n.id)}
              disabled={!n.alive || busy}
              aria-pressed={selected}
            >
              <span className="node-name">{n.name ?? vIdx}</span>
              <span className="node-url">{n.url.replace(/^https?:\/\//, '')}</span>
              <span className="node-meta">
                {n.alive ? (
                  <>
                    <span className="tag tag-red">altura {n.blockNumber ?? '—'}</span>{' '}
                    <span style={{ color: 'var(--grey-dim)' }}>
                      {n.version}
                      {n.slot !== null ? ` · slot ${n.slot}` : ''}
                    </span>
                  </>
                ) : (
                  <span style={{ color: 'var(--red)' }}>
                    caido · la cadena sigue con los demas
                  </span>
                )}
              </span>
              {selected && <span className="node-on-mark">mirando este</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** Estado mientras se buscan los nodos, para que no aparezca un vacio sin mas. */
export function NodePickerBusy() {
  return (
    <Card title="Nodos" note="buscando">
      <div className="empty">Buscando nodos...</div>
    </Card>
  );
}
