import { useState } from 'react';
import { api, ApiError, sensitive, when } from '../api.ts';
import { Badge, Button, Field, Notice, Page, Table, useLoad } from '../ui.tsx';

interface Device {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  modelAccess: 'all' | 'selected';
  registeredVia: 'code' | 'auto';
  grantedModels: number;
  memories: number;
}
interface ModelOption {
  id: string;
  displayName: string;
  providerName: string;
  enabled: boolean;
  providerEnabled: boolean;
}
export function Devices() {
  const devices = useLoad<{ devices: Device[] }>(() => api('GET', '/admin/api/devices'));
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [access, setAccess] = useState<Device | null>(null);

  const unblock = async (d: Device) => {
    setError('');
    setMessage('');
    try {
      await sensitive(() => api('POST', `/admin/api/devices/${d.id}/unblock`));
      setMessage(`${d.name} is allowed again. It reconnects on its own the next time it checks in.`);
      devices.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not unblock.');
    }
  };

  return (
    <Page
      title="Devices"
      intro="Desktop apps connect on their own the first time they open, using the API address built into them. Every computer appears here; block one to cut its access on its next request. New computers can be turned off in Settings."
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <h2 className="section-title">Desktops</h2>
      <Table head={['Name', 'Status', 'Models', 'Memory', 'Connected', 'Last seen', 'Actions']} rows={devices.data?.devices.length ?? 0} empty="No desktop has connected yet. Open the desktop app once and it appears here.">
        {devices.data?.devices.map((d) => (
          <tr key={d.id}>
            <td><strong>{d.name}</strong></td>
            <td>{d.status === 'active' ? <Badge tone="ok">active</Badge> : <Badge tone="bad">blocked</Badge>}</td>
            <td className="small">{d.modelAccess === 'all' ? 'All enabled models' : `${d.grantedModels} selected`}</td>
            <td className="small">{d.memories > 0 ? <a href={`#/memory`}>{d.memories}</a> : <span className="muted">0</span>}</td>
            <td className="small">{when(d.createdAt)}</td>
            <td className="small">{when(d.lastSeenAt)}</td>
            <td className="actions">
              {d.status === 'active' && <Button small onClick={() => setAccess(d)}>Model access</Button>}
              {d.status === 'active' && <Button small variant="danger" onClick={() => setRevoking(d)}>Block</Button>}
              {d.status !== 'active' && <Button small onClick={() => unblock(d)}>Unblock</Button>}
            </td>
          </tr>
        ))}
      </Table>

      {access && (
        <AccessDialog
          d={access}
          onClose={() => setAccess(null)}
          onDone={(text) => {
            setMessage(text);
            setAccess(null);
            devices.reload();
          }}
        />
      )}
      {revoking && <RevokeDialog d={revoking} onClose={() => setRevoking(null)} onDone={() => { setMessage(`${revoking.name} was blocked.`); setRevoking(null); devices.reload(); }} />}
    </Page>
  );
}

function RevokeDialog(props: { d: Device; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const run = async () => {
    try {
      await sensitive(() => api('POST', `/admin/api/devices/${props.d.id}/revoke`, { confirmName: typed }));
      props.onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not block.');
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
        <h2 id="revoke-title" className="modal-title">Block {props.d.name}</h2>
        <div className="modal-body">
          <p>The desktop loses access immediately and cannot connect again from this installation until you unblock it.</p>
          <Field label={`Type "${props.d.name}" to confirm`}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="modal-footer">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="danger" disabled={typed !== props.d.name} onClick={run}>Block computer</Button>
        </div>
      </div>
    </div>
  );
}

/** Chooses which models a desktop may use. The server enforces it on every request; desktops see the change on their next sync. */
function AccessDialog(props: { d: Device; onClose: () => void; onDone: (text: string) => void }) {
  const current = useLoad<{ modelAccess: 'all' | 'selected'; modelIds: string[] }>(() => api('GET', `/admin/api/devices/${props.d.id}/models`));
  const models = useLoad<{ models: ModelOption[] }>(() => api('GET', '/admin/api/models'));
  const [mode, setMode] = useState<'all' | 'selected' | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const effectiveMode = mode ?? current.data?.modelAccess ?? 'all';
  const effectivePicked = picked ?? new Set(current.data?.modelIds ?? []);
  const toggle = (id: string) => {
    const next = new Set(effectivePicked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api('PUT', `/admin/api/devices/${props.d.id}/models`, { modelAccess: effectiveMode, modelIds: effectiveMode === 'selected' ? [...effectivePicked] : [] });
      props.onDone(effectiveMode === 'all' ? `${props.d.name} can use all enabled models.` : `${props.d.name} can use ${effectivePicked.size} selected model${effectivePicked.size === 1 ? '' : 's'}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const loading = current.loading || models.loading;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="access-title">
        <h2 id="access-title" className="modal-title">Model access: {props.d.name}</h2>
        <div className="modal-body">
          {(current.error || models.error) && <Notice kind="error">{current.error || models.error}</Notice>}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <>
              <label className="radio">
                <input type="radio" name="access" checked={effectiveMode === 'all'} onChange={() => setMode('all')} /> All enabled models (including ones you enable later)
              </label>
              <label className="radio">
                <input type="radio" name="access" checked={effectiveMode === 'selected'} onChange={() => setMode('selected')} /> Only the models selected below
              </label>
              {effectiveMode === 'selected' && (
                <div className="check-list" role="group" aria-label="Models this desktop may use">
                  {(models.data?.models ?? []).length === 0 && <p className="muted small">No models yet. Add them on the Models page.</p>}
                  {(models.data?.models ?? []).map((m) => (
                    <label key={m.id} className="check">
                      <input type="checkbox" checked={effectivePicked.has(m.id)} onChange={() => toggle(m.id)} /> {m.displayName}{' '}
                      <span className="muted small">
                        {m.providerName}
                        {!(m.enabled && m.providerEnabled) && ' · currently disabled'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          {error && <Notice kind="error">{error}</Notice>}
        </div>
        <div className="modal-footer">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || loading} onClick={save}>{busy ? 'Saving…' : 'Save access'}</Button>
        </div>
      </div>
    </div>
  );
}
