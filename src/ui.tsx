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

export function Stat(props: { label: string; value: ReactNode; hint?: ReactNode }) {
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

const ICONS: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  plug: 'M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  brain: 'M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V4.5A1.5 1.5 0 0 0 10.5 3H9zM15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M8 16H3v5',
  alert: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  key: 'M14.5 3a6.5 6.5 0 1 0-2.9 12.3L10 17H7v3H4v-3l6.7-6.7A6.5 6.5 0 0 1 14.5 3zM16 8h.01',
  bot: 'M9 3h6v3H9zM12 6v3M5 9h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM9 13v2M15 13v2M2 14H0.5M22 14h1.5',
  bell: 'M12 3a6 6 0 0 0-6 6v3.5L4 16v1h16v-1l-2-3.5V9a6 6 0 0 0-6-6zM9.5 19a2.5 2.5 0 0 0 5 0',
  shield: 'M12 3l8 3v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6zM9 11.5l2 2 4-4.5',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4M6 12l3-3 2.5 2.5L15 8l3 3',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z',
};

/** Line icons (24x24 grid), drawn with the current text color. */
export function Icon(props: { name: string; size?: number }) {
  const s = props.size ?? 16;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      <path d={ICONS[props.name] ?? ICONS.cube} />
    </svg>
  );
}
