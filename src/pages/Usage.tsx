import { useEffect, useState } from 'react';
import { api, when } from '../api.ts';
import { Badge, Button, Card, Field, Page, Spinner, Stat, Table, useLoad } from '../ui.tsx';

interface Usage {
  window: string;
  totals: { requests: number; ok: number; errors: number; cancelled: number; promptTokens: number; completionTokens: number; withoutUsage: number };
  byModel: { modelName: string; requests: number; failed: number }[];
  errorCodes: { code: string; count: number }[];
  series: { at: string; requests: number; failed: number }[];
  note: string;
}
interface LogRow {
  id: number;
  createdAt: string;
  deviceName: string | null;
  modelName: string;
  providerName: string;
  status: 'ok' | 'error' | 'cancelled';
  httpStatus: number;
  errorCode: string | null;
  stream: boolean;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  usageSource: string;
}

function bucketLabel(iso: string, win: '24h' | '7d'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return win === '24h' ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Request volume per bucket, drawn from the series the usage endpoint already returns. */
function VolumeChart({ series, win }: { series: Usage['series']; win: '24h' | '7d' }) {
  const max = Math.max(1, ...series.map((p) => p.requests));
  const total = series.reduce((n, p) => n + p.requests, 0);
  const failed = series.reduce((n, p) => n + p.failed, 0);
  const W = 640;
  const H = 180;
  const slot = W / Math.max(1, series.length);
  const bar = Math.max(2, Math.min(18, slot * 0.62));
  const unit = win === '24h' ? 'hour' : 'day';
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Request volume per ${unit}: ${total} requests, ${failed} failed. Peak ${max} per ${unit}. The same numbers are available as a table below.`}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - H * f} y2={H - H * f} className="chart-grid" />
        ))}
        {series.map((p, i) => {
          const h = Math.max(1, (p.requests / max) * (H - 6));
          const fh = p.failed ? Math.max(2, (p.failed / max) * (H - 6)) : 0;
          const x = i * slot + (slot - bar) / 2;
          return (
            <g key={p.at}>
              <title>{`${bucketLabel(p.at, win)}: ${p.requests} request(s), ${p.failed} failed`}</title>
              <rect x={x} y={H - h} width={bar} height={h} className="chart-bar" />
              {fh > 0 && <rect x={x + bar * 0.62} y={H - fh} width={bar * 0.38} height={fh} className="chart-bar-bad" />}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H} y2={H} className="chart-axis" />
      </svg>
      <div className="chart-foot">
        <span>{bucketLabel(series[0].at, win)}</span>
        <span>peak {max} / {unit}</span>
        <span>{bucketLabel(series[series.length - 1].at, win)}</span>
      </div>
      <p className="legend small">
        <span><i className="dot chart-dot" /> requests</span>
        <span><i className="dot chart-dot-bad" /> failed</span>
      </p>
      <details className="chart-table">
        <summary>Show the numbers</summary>
        <Table head={['Time', 'Requests', 'Failed']} rows={series.length}>
          {series.map((p) => (
            <tr key={p.at}>
              <td className="small">{when(p.at)}</td>
              <td>{p.requests}</td>
              <td>{p.failed}</td>
            </tr>
          ))}
        </Table>
      </details>
    </>
  );
}

export function Usage() {
  const [win, setWin] = useState<'24h' | '7d'>('24h');
  const [status, setStatus] = useState('');
  const [model, setModel] = useState('');
  const usage = useLoad<Usage>(() => api('GET', `/admin/api/usage?window=${win}`), [win]);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logError, setLogError] = useState('');

  const loadLogs = async (more: boolean, current: LogRow[] = []) => {
    setLoadingLogs(true);
    setLogError('');
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (status) qs.set('status', status);
      if (model) qs.set('model', model);
      if (more && cursor) qs.set('cursor', cursor);
      const res: { logs: LogRow[]; nextCursor: string | null } = await api('GET', `/admin/api/logs?${qs.toString()}`);
      setRows(more ? [...current, ...res.logs] : res.logs);
      setCursor(res.nextCursor);
    } catch (e) {
      setLogError(e instanceof Error ? e.message : 'Could not load logs.');
    } finally {
      setLoadingLogs(false);
    }
  };

  // Logs load on first view and again whenever a filter changes.
  useEffect(() => {
    void loadLogs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, model]);

  const t = usage.data?.totals;
  const series = usage.data?.series ?? [];
  return (
    <Page title="Usage & logs" intro="Request counts, latency and token usage. Logs hold metadata only: never prompts, replies or keys.">
      <div className="segmented" role="group" aria-label="Time window">
        <button className={win === '24h' ? 'seg seg-on' : 'seg'} onClick={() => setWin('24h')}>Last 24 hours</button>
        <button className={win === '7d' ? 'seg seg-on' : 'seg'} onClick={() => setWin('7d')}>Last 7 days</button>
      </div>
      {usage.error && <p className="notice notice-error" role="alert">{usage.error}</p>}
      {!usage.data && usage.loading && <Spinner />}
      {t && (
        <>
          <div className="stats">
            <Stat label="Requests" value={t.requests} />
            <Stat label="Succeeded" value={t.ok} />
            <Stat label="Failed" value={t.errors} />
            <Stat label="Cancelled by desktop" value={t.cancelled} />
            <Stat label="Prompt tokens" value={t.promptTokens.toLocaleString()} hint="provider-reported only" />
            <Stat label="Completion tokens" value={t.completionTokens.toLocaleString()} hint={`${t.withoutUsage} request(s) without usage`} />
          </div>
          <Card title={`Requests per ${win === '24h' ? 'hour' : 'day'}`}>
            {series.length ? <VolumeChart series={series} win={win} /> : <p className="muted">No requests in this window yet.</p>}
          </Card>
          <div className="two-col">
            <Card title="By model">
              <Table head={['Model', 'Requests', 'Failed']} rows={usage.data?.byModel.length ?? 0} empty="No requests in this window.">
                {usage.data?.byModel.map((m) => (
                  <tr key={m.modelName}>
                    <td>{m.modelName}</td>
                    <td>{m.requests}</td>
                    <td>{m.failed}</td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="Error codes">
              <Table head={['Code', 'Count']} rows={usage.data?.errorCodes.length ?? 0} empty="No errors in this window.">
                {usage.data?.errorCodes.map((e) => (
                  <tr key={e.code}>
                    <td className="mono small">{e.code}</td>
                    <td>{e.count}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
          <p className="muted small">{usage.data?.note}</p>
        </>
      )}

      <h2 className="section-title">Recent requests</h2>
      <div className="filters">
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="ok">Succeeded</option>
            <option value="error">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
        <Field label="Model">
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">All models</option>
            {usage.data?.byModel.map((m) => (
              <option key={m.modelName} value={m.modelName}>{m.modelName}</option>
            ))}
          </select>
        </Field>
        <Button onClick={() => loadLogs(false)} disabled={loadingLogs}>{loadingLogs ? 'Loading…' : 'Refresh'}</Button>
      </div>
      {logError && <p className="notice notice-error" role="alert">{logError}</p>}
      <Table head={['Time', 'Desktop', 'Model', 'Status', 'Latency', 'Tokens', 'Error']} rows={rows.length} empty="No requests match.">
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="small">{when(r.createdAt)}</td>
            <td className="small">{r.deviceName ?? '—'}</td>
            <td className="small">{r.modelName}<div className="muted">{r.providerName}{r.stream ? ' · stream' : ''}</div></td>
            <td>{r.status === 'ok' ? <Badge tone="ok">ok</Badge> : r.status === 'cancelled' ? <Badge>cancelled</Badge> : <Badge tone="bad">{r.httpStatus}</Badge>}</td>
            <td className="small">{r.latencyMs} ms{r.ttftMs !== null && <div className="muted">first token {r.ttftMs} ms</div>}</td>
            <td className="small">{r.usageSource === 'provider_reported' ? `${r.promptTokens ?? 0} / ${r.completionTokens ?? 0}` : <span className="muted">none</span>}</td>
            <td className="mono small">{r.errorCode ?? ''}</td>
          </tr>
        ))}
      </Table>
      {cursor && (
        <div className="center">
          <Button disabled={loadingLogs} onClick={() => loadLogs(true, rows)}>{loadingLogs ? 'Loading…' : 'Load older requests'}</Button>
        </div>
      )}
    </Page>
  );
}
