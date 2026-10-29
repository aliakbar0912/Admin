import { useState, type FormEvent } from 'react';
import { api, ApiError, sensitive } from '../api.ts';
import { Badge, Button, Field, Modal, Notice, Page, Table, useLoad } from '../ui.tsx';
import type { Provider } from './Providers.tsx';

type Support = boolean | null;
interface Capability {
  supported: Support;
  source: 'unknown' | 'admin' | 'provider_reported' | 'test';
  levels?: string[];
}
export interface Model {
  id: string;
  providerId: string;
  providerName: string;
  providerEnabled: boolean;
  upstreamModelId: string;
  displayName: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  contextWindow: number | null;
  capabilities: Record<'streaming' | 'tools' | 'vision' | 'reasoning' | 'embeddings', Capability>;
  fallbackModelId: string | null;
  source: 'manual' | 'discovered';
  lastListedAt: string | null;
}

const CAPS = ['streaming', 'tools', 'vision', 'reasoning', 'embeddings'] as const;

function capText(c: Capability): string {
  if (c.supported === null) return 'unknown';
  return `${c.supported ? 'yes' : 'no'} (${c.source === 'admin' ? 'set by you' : c.source === 'test' ? 'tested' : c.source === 'provider_reported' ? 'reported by provider' : 'unknown source'})`;
}

export function Models() {
  const [providerId, setProviderId] = useState('');
  const [enabled, setEnabled] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Model | null>(null);
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState<'enable' | 'disable' | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const params = new URLSearchParams();
  if (providerId) params.set('providerId', providerId);
  if (enabled) params.set('enabled', enabled);
  if (q) params.set('q', q);
  const models = useLoad<{ models: Model[] }>(() => api('GET', `/admin/api/models?${params.toString()}`), [providerId, enabled, q]);
  const providers = useLoad<{ providers: Provider[] }>(() => api('GET', '/admin/api/providers'));

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: 'success', text: ok });
      models.reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'The change failed.' });
    }
  };

  // Bulk actions act on the rows the current filters show. Enabling skips models on a disabled provider,
  // because the API refuses to enable those (the desktop would never receive them anyway).
  const shownModels = models.data?.models ?? [];
  const bulkTargets = bulk === 'enable' ? shownModels.filter((m) => !m.enabled && m.providerEnabled) : shownModels.filter((m) => m.enabled);
  const skipped = bulk === 'enable' ? shownModels.filter((m) => !m.enabled && !m.providerEnabled).length : 0;
  const runBulk = async () => {
    const targets = bulkTargets;
    const enabling = bulk === 'enable';
    setBulk(null);
    setMessage(null);
    let done = 0;
    let firstError = '';
    for (const m of targets) {
      try {
        await api('PATCH', `/admin/api/models/${m.id}`, { enabled: enabling });
        done++;
      } catch (e) {
        if (!firstError) firstError = `${m.displayName}: ${e instanceof ApiError ? e.message : 'the change failed'}`;
      }
    }
    const failedCount = targets.length - done;
    setMessage(
      failedCount
        ? { kind: 'error', text: `${done} model(s) updated, ${failedCount} failed. First error — ${firstError}` }
        : { kind: 'success', text: `${done} model(s) ${enabling ? 'enabled' : 'disabled'}.` },
    );
    models.reload();
  };

  return (
    <Page
      title="Models"
      intro="Only enabled models on enabled providers reach desktop users. Capabilities default to unknown; set them only when you know them. Unknown means the desktop will not assume the feature."
      actions={
        <>
          <Button disabled={!shownModels.some((m) => !m.enabled && m.providerEnabled)} onClick={() => setBulk('enable')}>Enable shown</Button>
          <Button disabled={!shownModels.some((m) => m.enabled)} onClick={() => setBulk('disable')}>Disable shown</Button>
          <Button variant="primary" onClick={() => setAdding(true)}>Add model</Button>
        </>
      }
    >
      <div className="filters">
        <Field label="Provider">
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">All providers</option>
            {providers.data?.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={enabled} onChange={(e) => setEnabled(e.target.value)}>
            <option value="">All</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </Field>
        <Field label="Search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or upstream id" />
        </Field>
      </div>
      {models.error && <Notice kind="error">{models.error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Table head={['Name', 'Upstream id', 'Provider', 'Enabled', 'Default', 'Capabilities', 'Actions']} rows={models.data?.models.length ?? 0} empty="No models yet. Discover models on a provider, or add one by hand.">
        {models.data?.models.map((m) => (
          <tr key={m.id}>
            <td>
              <strong>{m.displayName}</strong>
              {m.description && <div className="muted small">{m.description}</div>}
              <div className="muted small">
                {m.source === 'discovered' ? 'from the provider list' : 'added by hand'}
                {m.fallbackModelId && <> · fallback: {models.data?.models.find((x) => x.id === m.fallbackModelId)?.displayName ?? 'another model'}</>}
              </div>
            </td>
            <td className="mono small">{m.upstreamModelId}</td>
            <td>
              {m.providerName}
              {!m.providerEnabled && <div><Badge tone="warn">provider off</Badge></div>}
            </td>
            <td>
              <input
                type="checkbox"
                aria-label={`Enabled: ${m.displayName}`}
                checked={m.enabled}
                disabled={!m.providerEnabled && !m.enabled}
                onChange={(e) => run(() => api('PATCH', `/admin/api/models/${m.id}`, { enabled: e.target.checked }), `${m.displayName} ${e.target.checked ? 'enabled' : 'disabled'}.`)}
              />
              <div>
                {m.enabled && m.providerEnabled ? <Badge tone="ok">live for desktop</Badge> : <Badge>hidden from desktop</Badge>}
              </div>
            </td>
            <td>
              {m.isDefault ? (
                <Badge tone="ok">default</Badge>
              ) : (
                <Button small disabled={!m.enabled} onClick={() => run(() => api('POST', `/admin/api/models/${m.id}/default`), `${m.displayName} is now the default.`)}>Make default</Button>
              )}
            </td>
            <td className="small">
              {CAPS.map((c) => (
                <div key={c}>
                  {c}: <span className={m.capabilities[c].supported === null ? 'muted' : ''}>{capText(m.capabilities[c])}</span>
                </div>
              ))}
            </td>
            <td className="actions">
              <Button small onClick={() => setEditing(m)}>Edit</Button>
              <DeleteModel m={m} onDone={(text) => { setMessage({ kind: 'success', text }); models.reload(); }} />
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <EditModel
          m={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setMessage({ kind: 'success', text: 'Model saved.' });
            models.reload();
          }}
        />
      )}
      {adding && (
        <AddModel
          providers={providers.data?.providers ?? []}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setMessage({ kind: 'success', text: 'Model added (disabled until you enable it).' });
            models.reload();
          }}
        />
      )}
      {bulk && (
        <Modal title={bulk === 'enable' ? 'Enable the models shown?' : 'Disable the models shown?'} onClose={() => setBulk(null)}>
          <p>
            {bulkTargets.length === 0 ? (
              <>There is nothing to change in the current filter.</>
            ) : (
              <>
                This {bulk === 'enable' ? 'enables' : 'disables'} <strong>{bulkTargets.length} model(s)</strong>
                {providerId || enabled || q ? ' among the rows the current filters show.' : ' — every model in the catalogue.'}
              </>
            )}
          </p>
          {bulk === 'enable' && skipped > 0 && (
            <p className="muted small">{skipped} model(s) on a disabled provider will be skipped; enable the provider first.</p>
          )}
          {bulk === 'disable' && <p className="muted small">Desktop users lose these models immediately. Requests in flight are not affected.</p>}
          <div className="form-actions">
            <Button onClick={() => setBulk(null)}>Cancel</Button>
            <Button variant={bulk === 'disable' ? 'danger' : 'primary'} disabled={bulkTargets.length === 0} onClick={() => void runBulk()}>
              {bulk === 'enable' ? `Enable ${bulkTargets.length}` : `Disable ${bulkTargets.length}`}
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function DeleteModel(props: { m: Model; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  if (!open) return <Button small variant="danger" onClick={() => setOpen(true)}>Delete</Button>;
  const remove = async () => {
    try {
      await sensitive(() => api('DELETE', `/admin/api/models/${props.m.id}`, { confirmName: typed }));
      props.onDone(`${props.m.displayName} deleted.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete.');
    }
  };
  return (
    <Modal title={`Delete ${props.m.displayName}`} onClose={() => setOpen(false)}>
      <Field label={`Type "${props.m.displayName}" to confirm`}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="form-actions">
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="danger" disabled={typed !== props.m.displayName} onClick={remove}>Delete model</Button>
      </div>
    </Modal>
  );
}

function CapabilityFields(props: { value: Model['capabilities']; onChange: (v: Model['capabilities']) => void }) {
  const set = (c: (typeof CAPS)[number], supported: Support) => {
    props.onChange({ ...props.value, [c]: { ...props.value[c], supported, source: 'admin' } });
  };
  return (
    <fieldset className="caps">
      <legend>Capabilities</legend>
      {CAPS.map((c) => (
        <Field key={c} label={c}>
          <select
            value={props.value[c].supported === null ? 'unknown' : props.value[c].supported ? 'yes' : 'no'}
            onChange={(e) => set(c, e.target.value === 'unknown' ? null : e.target.value === 'yes')}
          >
            <option value="unknown">Unknown</option>
            <option value="yes">Supported</option>
            <option value="no">Not supported</option>
          </select>
        </Field>
      ))}
      <p className="muted small">Choosing a value marks it as set by the admin. Unknown is never treated as supported. Mark <strong>embeddings</strong> only on a model that serves <span className="mono">/embeddings</span>: desktops use it for the @codebase index.</p>
    </fieldset>
  );
}

function EditModel(props: { m: Model; onClose: () => void; onSaved: () => void }) {
  const [fallback, setFallback] = useState(props.m.fallbackModelId ?? '');
  // The full list, independent of the page filters, so any model can be chosen as the fallback.
  const all = useLoad<{ models: Model[] }>(() => api('GET', '/admin/api/models'));
  const [displayName, setDisplayName] = useState(props.m.displayName);
  const [description, setDescription] = useState(props.m.description);
  const [contextWindow, setContextWindow] = useState(props.m.contextWindow ? String(props.m.contextWindow) : '');
  const [caps, setCaps] = useState(props.m.capabilities);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('PATCH', `/admin/api/models/${props.m.id}`, {
        displayName,
        description,
        contextWindow: contextWindow ? Number(contextWindow) : null,
        capabilities: caps,
        fallbackModelId: fallback || null,
      });
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Edit ${props.m.displayName}`} onClose={props.onClose}>
      <form onSubmit={submit} className="form">
        <Field label="Display name">
          <input required maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Description">
          <input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Context window (tokens)" hint="Leave empty if unknown.">
          <input type="number" min={1} value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
        </Field>
        <CapabilityFields value={caps} onChange={setCaps} />
        <Field
          label="Fallback model"
          hint="Used by the server only when this model's provider fails before replying, and only if the fallback is enabled, allowed for that desktop, and known to support what the request uses."
        >
          <select value={fallback} onChange={(e) => setFallback(e.target.value)}>
            <option value="">No fallback</option>
            {(all.data?.models ?? [])
              .filter((x) => x.id !== props.m.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.displayName} ({x.providerName}){x.enabled ? '' : ' — disabled'}
                </option>
              ))}
          </select>
        </Field>
        <p className="muted small">Upstream id: <span className="mono">{props.m.upstreamModelId}</span> (never shown to desktop users)</p>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function AddModel(props: { providers: Provider[]; onClose: () => void; onSaved: () => void }) {
  const [providerId, setProviderId] = useState(props.providers[0]?.id ?? '');
  const [upstreamModelId, setUpstreamModelId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('POST', '/admin/api/models', { providerId, upstreamModelId, displayName: displayName || upstreamModelId });
      props.onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the model.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Add model" onClose={props.onClose}>
      <form onSubmit={submit} className="form">
        <Field label="Provider">
          <select required value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {props.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Upstream model id" hint="The exact id the provider uses, for example gpt-4o-mini.">
          <input required value={upstreamModelId} onChange={(e) => setUpstreamModelId(e.target.value)} />
        </Field>
        <Field label="Display name">
          <input maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Defaults to the upstream id" />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>Add model</Button>
        </div>
      </form>
    </Modal>
  );
}
