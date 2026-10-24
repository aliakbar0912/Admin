// API keys: programmatic access to the central platform's OpenAI-compatible endpoints (POST /v1/chat/completions and
// GET /v1/models) without a desktop device. The secret is shown once at creation; afterwards only its prefix and last
// four characters are visible. Requests made with a key appear in Usage & logs with the key's name.
import { useState, type FormEvent } from 'react';
import { api, ApiError, when } from '../api.ts';
import { Badge, Button, Field, Modal, Notice, Page, Table, useLoad } from '../ui.tsx';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  last4: string;
  scopes: string[];
  enabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CreatedKey {
  key: ApiKey;
  secret: string;
  authorizationHeader: string;
  note: string;
}

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

export function ApiKeys() {
  const { data, error, reload } = useLoad<{ keys: ApiKey[]; scopes: string[] }>(() => api('GET', '/admin/api/api-keys'));
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const toggle = async (k: ApiKey) => {
    setMessage(null);
    try {
      await api('PATCH', `/admin/api/api-keys/${k.id}`, { enabled: !k.enabled });
      setMessage({ kind: 'success', text: k.enabled ? `${k.name} can no longer be used.` : `${k.name} works again.` });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not change the key.' });
    }
  };

  const keys = data?.keys ?? [];
  return (
    <Page
      title="API keys"
      intro="Keys for scripts and integrations to call the platform API directly: an OpenAI-compatible chat endpoint and model list. A key counts against its own rate limit, and every request it makes shows up in Usage & logs under its name."
      actions={<Button variant="primary" onClick={() => setCreating(true)}>New API key</Button>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Table head={['Key', 'Scopes', 'Status', 'Last used', 'Requests', 'Actions']} rows={keys.length} empty="No API keys yet. Create one to call the API from a script, a build pipeline or another tool.">
        {keys.map((k) => {
          const expired = k.expiresAt !== null && new Date(k.expiresAt).getTime() <= Date.now();
          return (
            <tr key={k.id}>
              <td>
                <strong>{k.name}</strong>
                <div className="small muted mono">{k.keyPrefix}…{k.last4}</div>
              </td>
              <td className="small">{k.scopes.join(', ')}</td>
              <td>
                {expired ? <Badge tone="warn">expired</Badge> : k.enabled ? <Badge tone="ok">active</Badge> : <Badge tone="muted">off</Badge>}
                {k.expiresAt && <div className="small muted">until {when(k.expiresAt)}</div>}
              </td>
              <td className="small">{when(k.lastUsedAt)}</td>
              <td className="small">{k.requestCount.toLocaleString()}</td>
              <td className="actions">
                <Button small onClick={() => void toggle(k)}>{k.enabled ? 'Turn off' : 'Turn on'}</Button>
                <Button small variant="danger" onClick={() => setDeleting(k)}>Delete</Button>
              </td>
            </tr>
          );
        })}
      </Table>
      {creating && <KeyCreator onClose={() => setCreating(false)} onDone={(r) => { setCreating(false); setCreated(r); reload(); }} />}
      {created && (
        <Modal title="API key created" onClose={() => setCreated(null)} footer={<Button variant="primary" onClick={() => setCreated(null)}>I saved it</Button>}>
          <p><strong>{created.key.name}</strong> is ready. Copy the secret now; it is not stored in plain text and cannot be shown again.</p>
          <Field label="Secret">
            <textarea readOnly rows={2} className="mono" value={created.secret} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <Field label="Authorization header" hint="Send this header with every request. Chat: POST /v1/chat/completions. Model list: GET /v1/models.">
            <textarea readOnly rows={2} className="mono" value={created.authorizationHeader} onFocus={(e) => e.currentTarget.select()} />
          </Field>
        </Modal>
      )}
      {deleting ? (
        <Modal
          title={`Delete ${deleting.name}?`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const k = deleting;
                  setDeleting(null);
                  try {
                    await api('DELETE', `/admin/api/api-keys/${k.id}`);
                    setMessage({ kind: 'success', text: `${k.name} deleted. Requests with it are refused from now on.` });
                    reload();
                  } catch (e) {
                    setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not delete.' });
                  }
                }}
              >
                Delete
              </Button>
            </>
          }
        >
          <p>Scripts and integrations using this key stop working immediately. Its past requests stay in the usage logs.</p>
        </Modal>
      ) : null}
    </Page>
  );
}

function KeyCreator(props: { onClose: () => void; onDone: (r: CreatedKey) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['chat']);
  const [expiry, setExpiry] = useState('never');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problems = [
    !name.trim() && 'Name is required.',
    name.length > 80 && 'Name: at most 80 characters.',
    scopes.length === 0 && 'Pick at least one scope.',
  ].filter(Boolean) as string[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError('');
    try {
      const expiresAt = expiry === 'never' ? 'never' : new Date(Date.now() + Number(expiry) * 24 * 3600 * 1000).toISOString();
      const r = await api<CreatedKey>('POST', '/admin/api/api-keys', { name: name.trim(), scopes, expiresAt });
      props.onDone(r);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the key.');
      setBusy(false);
    }
  };

  return (
    <Modal title="New API key" onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Name" hint="What uses this key, for example “Nightly build script”.">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </Field>
        <Field label="Scopes" hint="chat: send chat requests. models: list the available models.">
          <div className="check-row">
            {['chat', 'models'].map((s) => (
              <label key={s} className="check">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
                />
                {s}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Expires">
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        {problems.length ? <Notice kind="info">{problems.join(' ')}</Notice> : null}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || problems.length > 0}>{busy ? 'Creating…' : 'Create key'}</Button>
        </div>
      </form>
    </Modal>
  );
}
