import { useEffect, useState } from 'react';
import { api, ApiError, sensitive, when } from '../api.ts';
import { Badge, Button, Card, Field, Modal, Notice, Page, Spinner, Stat, Table } from '../ui.tsx';

interface MemoryRow {
  id: string;
  deviceId: string;
  deviceName: string | null;
  scope: 'global' | 'project';
  projectKey: string;
  kind: 'fact' | 'preference' | 'lesson' | 'decision';
  content: string;
  tags: string[];
  source: 'user' | 'agent' | 'system';
  confidence: number;
  verified: boolean;
  pinned: boolean;
  hits: number;
  deleted: boolean;
  updatedAt: string;
}
interface MemoryList {
  total: number;
  active: number;
  memories: MemoryRow[];
}
interface DeviceRow {
  id: string;
  name: string;
  memories: number;
}

const KIND_TONE: Record<MemoryRow['kind'], 'ok' | 'warn' | 'bad' | 'muted'> = { preference: 'ok', lesson: 'warn', decision: 'ok', fact: 'muted' };
const PAGE_SIZE = 100;

export function Memory() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [scope, setScope] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [totals, setTotals] = useState<{ total: number; active: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [forget, setForget] = useState<{ title: string; confirmLabel: string; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const devices = useDevicesWithMemory();

  // The text filter follows the typing with a short debounce; every other filter reloads at once.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const load = async (more: boolean, current: MemoryRow[] = []) => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(more ? offset : 0) });
      if (query) qs.set('q', query);
      if (kind) qs.set('kind', kind);
      if (scope) qs.set('scope', scope);
      if (deviceId) qs.set('deviceId', deviceId);
      const res: MemoryList = await api('GET', `/admin/api/memory?${qs.toString()}`);
      setTotals({ total: res.total, active: res.active });
      setRows(more ? [...current, ...res.memories] : res.memories);
      setOffset(more ? offset + res.memories.length : res.memories.length);
      setHasMore(res.memories.length === PAGE_SIZE && res.memories.length < res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load memories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, kind, scope, deviceId]);

  const runForget = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setForget(null);
      setMessage('The selected memories are forgotten. The devices keep their local copy and will not re-upload it.');
      await load(false);
      devices.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not clear memories.');
    } finally {
      setBusy(false);
    }
  };

  const clearAll = () =>
    setForget({
      title: 'Forget every memory?',
      confirmLabel: 'Forget everything',
      run: () => runForget(() => sensitive(() => api('DELETE', '/admin/api/memory'))),
    });

  const clearDevice = (d: DeviceRow) =>
    setForget({
      title: `Forget the memories of ${d.name}?`,
      confirmLabel: 'Forget this computer',
      run: () => runForget(() => sensitive(() => api('DELETE', `/admin/api/memory/${d.id}`))),
    });

  const withMemory = devices.data?.filter((d) => d.memories > 0) ?? [];
  return (
    <Page
      title="Memory"
      intro="The long-term memory your desktops sync to this platform: facts about projects, your preferences, decisions and lessons. Every computer keeps its own pool, secrets are never stored, and each desktop restores its memory from here after a reinstall. Nothing here is sent to any provider."
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <div className="stats">
        <Stat label="Stored memories" value={totals?.total ?? 0} hint="including forgotten tombstones" />
        <Stat label="Active" value={totals?.active ?? 0} hint="used by the agent" />
        <Stat label="Computers with memory" value={withMemory.length} />
      </div>

      <div className="filters">
        <Field label="Search">
          <input type="search" placeholder="Search memory text…" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            <option value="fact">Facts</option>
            <option value="preference">Preferences</option>
            <option value="decision">Decisions</option>
            <option value="lesson">Lessons</option>
          </select>
        </Field>
        <Field label="Scope">
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">All scopes</option>
            <option value="global">Global</option>
            <option value="project">Project</option>
          </select>
        </Field>
        <Field label="Computer">
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">All computers</option>
            {withMemory.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.memories})
              </option>
            ))}
          </select>
        </Field>
        <Button onClick={() => load(false)}>Refresh</Button>
      </div>

      {loading && rows.length === 0 ? (
        <Spinner />
      ) : (
        <Table
          head={['Updated', 'Computer', 'Scope', 'Kind', 'Memory', 'Details']}
          rows={rows.length}
          empty="No memories match. Memories appear here after a desktop connects and syncs (Settings → Memory in the app shows when)."
        >
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="small">{when(m.updatedAt)}</td>
              <td className="small">{m.deviceName ?? '—'}</td>
              <td className="small">
                {m.scope === 'global' ? <Badge tone="muted">global</Badge> : <Badge>project</Badge>}
                {m.projectKey && <div className="muted mono">{m.projectKey}</div>}
              </td>
              <td>
                <Badge tone={KIND_TONE[m.kind]}>{m.kind}</Badge>
              </td>
              <td className="small memory-content">{m.content}</td>
              <td className="small">
                {m.deleted ? (
                  <Badge tone="bad">forgotten</Badge>
                ) : (
                  <>
                    <div className="muted">
                      by {m.source} · {Math.round(m.confidence * 100)}% sure
                    </div>
                    <div className="muted">
                      {m.hits} use{m.hits === 1 ? '' : 's'}
                      {m.verified ? ' · verified' : ''}
                      {m.pinned ? ' · pinned' : ''}
                    </div>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {hasMore && (
        <div className="center">
          <Button disabled={loading} onClick={() => load(true, rows)}>
            {loading ? 'Loading…' : 'Load older memories'}
          </Button>
        </div>
      )}

      <h2 className="section-title">Forget memories</h2>
      <Card title="Danger zone">
        <p className="muted small">
          Forgetting removes memories from this platform. Desktops keep their own local copy, so they do not lose anything and do not re-upload what you removed here. These
          actions need your password confirmation.
        </p>
        <div className="form-actions">
          {deviceId && withMemory.some((d) => d.id === deviceId) && (
            <Button variant="danger" onClick={() => clearDevice(withMemory.find((d) => d.id === deviceId)!)}>
              Forget this computer's memories
            </Button>
          )}
          <Button variant="danger" onClick={clearAll}>
            Forget all memories
          </Button>
        </div>
      </Card>

      {forget && (
        <Modal title={forget.title} onClose={() => (busy ? undefined : setForget(null))}>
          <div className="form">
            <p className="muted">This cannot be undone. The memories are removed from the platform; the desktop keeps its local copy.</p>
            <div className="form-actions">
              <Button onClick={() => setForget(null)}>Cancel</Button>
              <Button variant="primary" disabled={busy} onClick={() => void forget.run()}>
                {busy ? 'Working…' : forget.confirmLabel}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function useDevicesWithMemory() {
  const [state, setState] = useState<{ data: DeviceRow[] | null; error: string }>({ data: null, error: '' });
  const reload = () => {
    api<{ devices: DeviceRow[] }>('GET', '/admin/api/devices')
      .then((res) => setState({ data: res.devices, error: '' }))
      .catch((e) => setState({ data: null, error: e instanceof ApiError ? e.message : 'Could not load devices.' }));
  };
  useEffect(reload, []);
  return { data: state.data, error: state.error, reload };
}
