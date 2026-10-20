// Small, dependency-free UI primitives.
import { useEffect, useId, useState, type ReactNode } from 'react';

export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    load()
      .then((d) => {
        if (live) {
          setData(d);
          setError('');
        }
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function Page(props: { title: string; actions?: ReactNode; children: ReactNode; intro?: string }) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>{props.title}</h1>
          {props.intro && <p className="intro">{props.intro}</p>}
        </div>
        {props.actions && <div className="page-actions">{props.actions}</div>}
      </header>
      {props.children}
    </section>
  );
}

export function Card(props: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="card">
      {props.title && <h2 className="card-title">{props.title}</h2>}
      <div className="card-body">{props.children}</div>
      {props.footer && <div className="card-footer">{props.footer}</div>}
    </div>
  );
}

export function Stat(props: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.hint && <div className="stat-hint">{props.hint}</div>}
    </div>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type={props.type ?? 'button'}
      className={`btn btn-${props.variant ?? 'secondary'}${props.small ? ' btn-small' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Notice(props: { kind?: 'error' | 'info' | 'success'; children: ReactNode }) {
  return (
    <div className={`notice notice-${props.kind ?? 'info'}`} role={props.kind === 'error' ? 'alert' : 'status'}>
      {props.children}
    </div>
  );
}

export function Badge(props: { tone?: 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  return <span className={`badge badge-${props.tone ?? 'muted'}`}>{props.children}</span>;
}

export function Table(props: { head: string[]; children: ReactNode; empty?: string; rows: number }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {props.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows === 0 ? (
            <tr>
              <td colSpan={props.head.length} className="muted">
                {props.empty ?? 'Nothing here yet.'}
              </td>
            </tr>
          ) : (
            props.children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  // Each modal gets its own id, so stacked dialogs are labelled by their own title.
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="modal-title">
          {props.title}
        </h2>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-footer">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Spinner() {
  return <p className="muted">Loading…</p>;
}
