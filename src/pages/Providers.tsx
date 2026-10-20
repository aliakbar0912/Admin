import { useState, type FormEvent } from 'react';
import { api, ApiError, sensitive, when } from '../api.ts';
import { Badge, Button, Field, Modal, Notice, Page, Table, useLoad } from '../ui.tsx';

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  authScheme: 'bearer' | 'none';
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
  hasApiKey: boolean;
  modelCount: number;
  lastTest: { ok: boolean; at: string; latencyMs: number; message: string; kind?: string | null } | null;
  discovery?: { ok: boolean; supported: boolean | null; at: string; message: string } | null;
}

type Dialog = { kind: 'create' } | { kind: 'edit'; p: Provider } | { kind: 'key'; p: Provider } | { kind: 'delete'; p: Provider };

type StatusFilter = '' | 'enabled' | 'disabled' | 'untested' | 'failed';

export function Providers() {
  const { data, error, reload } = useLoad<{ providers: Provider[] }>(() => api('GET', '/admin/api/providers'));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busyId, setBusyId] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');

  const all = data?.providers ?? [];
  const needle = q.trim().toLowerCase();
  const providers = all.filter((p) => {
    if (needle && !p.name.toLowerCase().includes(needle) && !p.baseUrl.toLowerCase().includes(needle)) return false;
    if (status === 'enabled') return p.enabled;
    if (status === 'disabled') return !p.enabled;
    if (status === 'untested') return !p.lastTest;
    if (status === 'failed') return p.lastTest?.ok === false;
    return true;
  });

  const act = async (p: Provider, fn: () => Promise<any>, ok: string | ((r: any) => string)) => {
    setBusyId(p.id);
    setMessage(null);
    try {
      const r = await fn();
      setMessage({ kind: 'success', text: typeof ok === 'string' ? ok : ok(r) });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'The action failed.' });
    } finally {
      setBusyId('');
    }
  };

  return (
    <Page
      title="Providers"
      intro="Upstream endpoints the central service calls. API keys are encrypted on the server and are never shown again. Plain http is allowed only for localhost."
      actions={<Button variant="primary" onClick={() => setDialog({ kind: 'create' })}>Add provider</Button>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <div className="filters">
        <Field label="Search">
          <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Name or base URL" />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(ev) => setStatus(ev.target.value as StatusFilter)}>
            <option value="">All</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
            <option value="untested">Not tested</option>
            <option value="failed">Last test failed</option>
          </select>
        </Field>
      </div>
      <Table head={['Name', 'Base URL', 'API key', 'Enabled', 'Last test', 'Models', 'Actions']} rows={providers.length} empty={all.length ? 'No providers match these filters.' : 'No providers yet. Add one to start.'}>
        {providers.map((p) => (
          <tr key={p.id}>
            <td><strong>{p.name}</strong></td>
            <td className="mono small">{p.baseUrl}</td>
            <td>{p.authScheme === 'none' ? <Badge>not used</Badge> : p.hasApiKey ? <Badge tone="ok">stored</Badge> : <Badge tone="bad">missing</Badge>}</td>
            <td>{p.enabled ? <Badge tone="ok">yes</Badge> : <Badge>no</Badge>}</td>
            <td className="small">
              {p.lastTest ? (
                <>
                  {p.lastTest.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="bad">failed</Badge>} <span className="muted">{when(p.lastTest.at)}</span>
                  <div className="muted">{p.lastTest.message}</div>
                </>
              ) : (
                <span className="muted">not tested</span>
              )}
            </td>
            <td className="small">
              {p.modelCount}
              {p.discovery ? (
                p.discovery.supported === false ? (
                  <div><Badge>no model list</Badge><div className="muted">add models by exact id</div></div>
                ) : p.discovery.ok ? (
                  <div className="muted">list refreshed {when(p.discovery.at)}</div>
                ) : (
                  <div><Badge tone="warn">refresh failed</Badge><div className="muted">{p.discovery.message}</div></div>
                )
              ) : null}
            </td>
            <td className="actions">
              <Button small disabled={busyId === p.id} onClick={() => act(p, () => api('POST', `/admin/api/providers/${p.id}/test`), `${p.name}: test finished.`)}>Test</Button>
              <Button small disabled={busyId === p.id} onClick={() => act(p, () => api('POST', `/admin/api/providers/${p.id}/discover`), (r) => `${p.name}: ${r?.message ?? 'models refreshed'}. New models are added disabled.`)}>Refresh models</Button>
              <Button small onClick={() => setDialog({ kind: 'key', p })}>{p.hasApiKey ? 'Replace key' : 'Set key'}</Button>
              <Button small onClick={() => setDialog({ kind: 'edit', p })}>Edit</Button>
              <Button small variant="danger" onClick={() => setDialog({ kind: 'delete', p })}>Delete</Button>
            </td>
          </tr>
        ))}
      </Table>
      {dialog?.kind === 'create' && (
        <ProviderForm
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            setMessage({ kind: 'success', text: `${name} added. Set its API key, then test it.` });
            reload();
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <ProviderForm
          existing={dialog.p}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            setMessage({ kind: 'success', text: `${name} saved.` });
            reload();
          }}
        />
      )}
      {dialog?.kind === 'key' && (
        <KeyForm
          p={dialog.p}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setMessage({ kind: 'success', text: `${dialog.p.name}: API key stored. Run a test to confirm it.` });
            reload();
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteProvider
          p={dialog.p}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            setMessage({ kind: 'success', text: 'Provider deleted. Its models were removed too.' });
            reload();
          }}
        />
      )}
    </Page>
  );
}

function ProviderForm(props: { existing?: Provider; onClose: () => void; onSaved: (name: string) => void }) {
  const e = props.existing;
  const [name, setName] = useState(e?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(e?.baseUrl ?? '');
  const [authScheme, setAuthScheme] = useState<'bearer' | 'none'>(e?.authScheme ?? 'bearer');
  const [enabled, setEnabled] = useState(e?.enabled ?? true);
  const [timeoutSec, setTimeoutSec] = useState(String(Math.round((e?.timeoutMs ?? 120000) / 1000)));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError('');
    const body = { name, baseUrl, authScheme, enabled, timeoutMs: Number(timeoutSec) * 1000 };
    try {
      if (e) await api('PATCH', `/admin/api/providers/${e.id}`, body);
      else await api('POST', '/admin/api/providers', body);
      props.onSaved(name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={e ? `Edit ${e.name}` : 'Add provider'} onClose={props.onClose}>
      <form onSubmit={submit} className="form">
        <Field label="Name" hint="Shown in the admin site and in logs.">
          <input required maxLength={80} value={name} onChange={(ev) => setName(ev.target.value)} />
        </Field>
        <Field label="Base URL" hint="For example https://api.example.com/v1 (OpenAI-compatible; the path usually ends in /v1).">
          <input required value={baseUrl} onChange={(ev) => setBaseUrl(ev.target.value)} placeholder="https://api.example.com/v1" />
        </Field>
        <Field label="Authentication">
          <select value={authScheme} onChange={(ev) => setAuthScheme(ev.target.value as 'bearer' | 'none')}>
            <option value="bearer">API key (Bearer)</option>
            <option value="none">None (local endpoint)</option>
          </select>
        </Field>
        <Field label="Timeout (seconds)" hint="How long to wait for the provider before giving up.">
          <input type="number" min={1} max={600} value={timeoutSec} onChange={(ev) => setTimeoutSec(ev.target.value)} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(ev) => setEnabled(ev.target.checked)} /> Enabled
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function KeyForm(props: { p: Provider; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sensitive(() => api('PUT', `/admin/api/providers/${props.p.id}/api-key`, { apiKey: key }));
      setKey('');
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not store the key.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`API key for ${props.p.name}`} onClose={props.onClose}>
      <form onSubmit={submit} className="form" autoComplete="off">
        <p className="muted">The key is sent once, encrypted on the server, and never displayed again. Replacing it resets the last test result.</p>
        <Field label="API key">
          <input type="password" required minLength={8} value={key} onChange={(ev) => setKey(ev.target.value)} autoComplete="new-password" spellCheck={false} />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Storing…' : 'Store key'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteProvider(props: { p: Provider; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await sensitive(() => api('DELETE', `/admin/api/providers/${props.p.id}`, { confirmName: typed }));
      props.onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete.');
      setBusy(false);
    }
  };
  return (
    <Modal title={`Delete ${props.p.name}`} onClose={props.onClose}>
      <p>This removes the provider, its stored key, and its {props.p.modelCount} model(s). Request logs keep the names.</p>
      <Field label={`Type "${props.p.name}" to confirm`}>
        <input value={typed} onChange={(ev) => setTyped(ev.target.value)} autoComplete="off" />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="form-actions">
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="danger" disabled={busy || typed !== props.p.name} onClick={remove}>Delete provider</Button>
      </div>
    </Modal>
  );
}
