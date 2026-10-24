// Web search providers for the agent's web_search tool. Keys are encrypted on the server and never shown again; desktops
// only ever receive search results. The default provider answers first; the others are fallbacks in priority order.
import { useState, type FormEvent } from 'react';
import { api, ApiError, sensitive, when } from '../api.ts';
import { Badge, Button, Card, Field, Modal, Notice, Page, Stat, Table, useLoad } from '../ui.tsx';

interface SearchProvider {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  baseUrl: string | null;
  options: Record<string, string>;
  enabled: boolean;
  isDefault: boolean;
  priority: number;
  hasApiKey: boolean;
  needsApiKey: boolean;
  ready: boolean;
  lastTest: { ok: boolean; at: string; latencyMs: number; message: string } | null;
}
interface Kind {
  kind: string;
  label: string;
  needsKey: boolean;
  needsBaseUrl: boolean;
  options: string[];
  signup: string;
}
interface ListResponse {
  providers: SearchProvider[];
  kinds: Kind[];
  last7Days: { total: number; failed: number; cached: number; avg_ms: number };
  perMinute: number;
}
interface TestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  results: { title: string; url: string; snippet: string }[];
}

type Dialog = { kind: 'create' } | { kind: 'key'; p: SearchProvider } | { kind: 'edit'; p: SearchProvider } | { kind: 'delete'; p: SearchProvider } | { kind: 'test'; p: SearchProvider };

export function WebSearch() {
  const { data, error, reload } = useLoad<ListResponse>(() => api('GET', '/admin/api/search-providers'));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState('');

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: 'success', text: ok });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'The action failed.' });
    } finally {
      setBusy('');
    }
  };

  const providers = data?.providers ?? [];
  const ready = providers.filter((p) => p.ready).length;
  return (
    <Page
      title="Web search"
      intro="Search providers for the agent's web_search tool. Keys are encrypted on the server and never sent to desktops. The default provider answers first; if it fails, the next ready provider is tried."
      actions={<Button variant="primary" onClick={() => setDialog({ kind: 'create' })}>Add search provider</Button>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {data && !ready ? (
        <Notice kind="info">Web search is off for desktops: add a provider, store its API key and test it. The agent gets web_search as soon as one provider is ready.</Notice>
      ) : null}
      <div className="stats">
        <Stat label="Ready providers" value={ready} hint={ready ? 'web_search is on for desktops' : 'web_search is off'} />
        <Stat label="Searches (7 days)" value={data?.last7Days.total ?? '—'} hint={data ? `${data.last7Days.cached} from cache` : undefined} />
        <Stat label="Failed (7 days)" value={data?.last7Days.failed ?? '—'} hint="a fallback may have answered" />
        <Stat label="Average time" value={data ? `${data.last7Days.avg_ms} ms` : '—'} hint={data ? `limit ${data.perMinute}/min per device (Settings)` : undefined} />
      </div>
      <Table head={['Provider', 'Type', 'API key', 'Status', 'Last test', 'Actions']} rows={providers.length} empty="No search providers yet. Add Tavily, Brave, Serper, Exa, Google or your own SearXNG.">
        {providers.map((p) => (
          <tr key={p.id}>
            <td>
              <strong>{p.name}</strong> {p.isDefault ? <Badge tone="ok">default</Badge> : <span className="small muted">fallback #{p.priority}</span>}
              {p.baseUrl ? <div className="small muted mono">{p.baseUrl}</div> : null}
            </td>
            <td className="small">{p.kindLabel}</td>
            <td className="small">{!p.needsApiKey ? <span className="muted">not needed</span> : p.hasApiKey ? <Badge tone="ok">stored</Badge> : <Badge tone="warn">missing</Badge>}</td>
            <td>{!p.enabled ? <Badge tone="muted">disabled</Badge> : p.ready ? <Badge tone="ok">ready</Badge> : <Badge tone="warn">needs setup</Badge>}</td>
            <td className="small">{p.lastTest ? <>{p.lastTest.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="bad">failed</Badge>} {p.lastTest.message} <span className="muted">· {when(p.lastTest.at)}</span></> : <span className="muted">never</span>}</td>
            <td className="actions">
              <Button small disabled={busy === p.id} onClick={() => setDialog({ kind: 'test', p })}>Test</Button>
              {p.needsApiKey || p.kind === 'searxng' ? <Button small onClick={() => setDialog({ kind: 'key', p })}>{p.hasApiKey ? 'Replace key' : 'Set key'}</Button> : null}
              <Button small onClick={() => setDialog({ kind: 'edit', p })}>Edit</Button>
              {!p.isDefault && p.enabled ? <Button small disabled={busy === p.id} onClick={() => act(p.id, () => api('PATCH', `/admin/api/search-providers/${p.id}`, { isDefault: true }), `${p.name} is now the default.`)}>Make default</Button> : null}
              <Button small disabled={busy === p.id} onClick={() => act(p.id, () => api('PATCH', `/admin/api/search-providers/${p.id}`, { enabled: !p.enabled }), p.enabled ? `${p.name} disabled.` : `${p.name} enabled.`)}>{p.enabled ? 'Disable' : 'Enable'}</Button>
              <Button small variant="danger" onClick={() => setDialog({ kind: 'delete', p })}>Delete</Button>
            </td>
          </tr>
        ))}
      </Table>

      <Card title="Which provider?">
        <ul className="small">
          {(data?.kinds ?? []).map((k) => (
            <li key={k.kind}>
              <strong>{k.label}</strong> — {k.needsKey ? 'API key' : 'no key'}{k.needsBaseUrl ? ', your server address' : ''}{k.options.includes('cx') ? ', search engine id (cx)' : ''}. Sign up at <span className="mono">{k.signup}</span>.
            </li>
          ))}
        </ul>
      </Card>

      {dialog?.kind === 'create' && data ? <CreateDialog kinds={data.kinds} onClose={() => setDialog(null)} onDone={(name, needsKey) => { setDialog(null); setMessage({ kind: 'success', text: needsKey ? `${name} added. Now set its API key, then test it.` : `${name} added. Test it to make sure it answers.` }); reload(); }} /> : null}
      {dialog?.kind === 'key' ? <KeyDialog p={dialog.p} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setMessage({ kind: 'success', text: 'API key stored. Test the provider now.' }); reload(); }} /> : null}
      {dialog?.kind === 'edit' ? <EditDialog p={dialog.p} kind={data?.kinds.find((k) => k.kind === dialog.p.kind)} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setMessage({ kind: 'success', text: 'Saved.' }); reload(); }} /> : null}
      {dialog?.kind === 'test' ? <TestDialog p={dialog.p} onClose={() => { setDialog(null); reload(); }} /> : null}
      {dialog?.kind === 'delete' ? (
        <Modal
          title={`Delete ${dialog.p.name}?`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => { const p = dialog.p; setDialog(null); void act(p.id, () => sensitive(() => api('DELETE', `/admin/api/search-providers/${p.id}`)), `${p.name} deleted.`); }}>Delete</Button>
            </>
          }
        >
          <p>The provider and its stored key are removed. If it was the only ready provider, the agent's web_search turns off.</p>
        </Modal>
      ) : null}
    </Page>
  );
}

function CreateDialog(props: { kinds: Kind[]; onClose: () => void; onDone: (name: string, needsKey: boolean) => void }) {
  const [kind, setKind] = useState(props.kinds[0]?.kind ?? 'tavily');
  const info = props.kinds.find((k) => k.kind === kind);
  const [name, setName] = useState(info?.label ?? '');
  const [baseUrl, setBaseUrl] = useState('');
  const [cx, setCx] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('POST', '/admin/api/search-providers', { name: name.trim(), kind, ...(info?.needsBaseUrl ? { baseUrl } : {}), ...(info?.options.includes('cx') ? { options: { cx } } : {}) });
      props.onDone(name.trim(), !!info?.needsKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the provider.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Add search provider" onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Type">
          <select value={kind} onChange={(e) => { setKind(e.target.value); setName(props.kinds.find((k) => k.kind === e.target.value)?.label ?? ''); }}>
            {props.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </Field>
        {info?.needsBaseUrl ? (
          <Field label="SearXNG address" hint="Your instance, for example https://search.YOUR_DOMAIN. JSON output must be enabled in its settings.">
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://search.YOUR_DOMAIN" required />
          </Field>
        ) : null}
        {info?.options.includes('cx') ? (
          <Field label="Search engine id (cx)" hint="From programmablesearchengine.google.com → your engine → Search engine ID.">
            <input value={cx} onChange={(e) => setCx(e.target.value)} required />
          </Field>
        ) : null}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function KeyDialog(props: { p: SearchProvider; onClose: () => void; onDone: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sensitive(() => api('PUT', `/admin/api/search-providers/${props.p.id}/api-key`, { apiKey: key.trim() }));
      props.onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not store the key.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`API key for ${props.p.name}`} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <p className="small muted">Stored encrypted on the server. It is never shown again and never sent to desktops.{props.p.kind === 'searxng' ? ' Optional for SearXNG (sent as a Bearer token if your instance is protected).' : ''}</p>
        <Field label="API key">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" required />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          {props.p.hasApiKey ? <Button variant="danger" onClick={async () => { try { await sensitive(() => api('DELETE', `/admin/api/search-providers/${props.p.id}/api-key`)); props.onDone(); } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not remove the key.'); } }}>Remove key</Button> : null}
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || key.trim().length < 8}>{busy ? 'Saving…' : 'Store key'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditDialog(props: { p: SearchProvider; kind?: Kind; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(props.p.name);
  const [priority, setPriority] = useState(props.p.priority);
  const [baseUrl, setBaseUrl] = useState(props.p.baseUrl ?? '');
  const [cx, setCx] = useState(props.p.options.cx ?? '');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('PATCH', `/admin/api/search-providers/${props.p.id}`, {
        name: name.trim(),
        priority,
        ...(props.kind?.needsBaseUrl ? { baseUrl } : {}),
        ...(props.kind?.options.includes('cx') ? { options: { cx } } : {}),
      });
      props.onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  };
  return (
    <Modal title={`Edit ${props.p.name}`} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Fallback order" hint="Lower answers first after the default (0 to 1000)."><input type="number" min={0} max={1000} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></Field>
        {props.kind?.needsBaseUrl ? <Field label="SearXNG address"><input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></Field> : null}
        {props.kind?.options.includes('cx') ? <Field label="Search engine id (cx)"><input value={cx} onChange={(e) => setCx(e.target.value)} /></Field> : null}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function TestDialog(props: { p: SearchProvider; onClose: () => void }) {
  const [query, setQuery] = useState('latest Node.js LTS release');
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api<TestResult>('POST', `/admin/api/search-providers/${props.p.id}/test`, { query }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The test failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Test ${props.p.name}`} onClose={props.onClose} footer={<Button onClick={props.onClose}>Close</Button>}>
      <form className="toolbar" onSubmit={run}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Test query" />
        <Button type="submit" variant="primary" disabled={busy || !query.trim()}>{busy ? 'Searching…' : 'Search'}</Button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
      {result ? (
        <>
          <Notice kind={result.ok ? 'success' : 'error'}>{result.message} ({result.latencyMs} ms)</Notice>
          <ol className="search-results">
            {result.results.map((r) => (
              <li key={r.url}>
                <strong>{r.title}</strong>
                <div className="small mono muted">{r.url}</div>
                <div className="small">{r.snippet}</div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Modal>
  );
}
