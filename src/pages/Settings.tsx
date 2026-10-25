import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, sensitive } from '../api.ts';
import { Button, Card, Field, Notice, Page, Spinner, useLoad } from '../ui.tsx';
interface Settings {
  rateLimitPerMinute: number;
  maxConcurrentPerDevice: number;
  maxOutputTokens: number;
  allowDirectProvider: boolean;
  allowAutoRegistration: boolean;
  requireLoginForCentralAi: boolean;
  searchPerMinute: number;
  apiKeyRateLimitPerMinute: number;
  accountsConfigured?: boolean;
}

export function Settings() {
  const { data, error, loading } = useLoad<Settings>(() => api('GET', '/admin/api/settings'));
  const [form, setForm] = useState<Settings | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading && !form) return <Spinner />;
  if (!form) return <Page title="Settings"><Notice kind="error">{error || 'Settings could not be loaded.'}</Notice></Page>;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const body = {
        rateLimitPerMinute: form.rateLimitPerMinute,
        maxConcurrentPerDevice: form.maxConcurrentPerDevice,
        maxOutputTokens: form.maxOutputTokens,
        searchPerMinute: form.searchPerMinute,
        apiKeyRateLimitPerMinute: form.apiKeyRateLimitPerMinute,
      };
      const saved: Settings = await api('PATCH', '/admin/api/settings', body);
      setForm(saved);
      setMessage({ kind: 'success', text: 'Settings saved. Desktops pick up the new limits on their next request.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleRegistration = async (on: boolean) => {
    setMessage(null);
    try {
      const saved: Settings = await api('PATCH', '/admin/api/settings', { allowAutoRegistration: on });
      setForm(saved);
      setMessage({ kind: 'success', text: on ? 'New computers can connect.' : 'New computers cannot connect. Computers already listed under Devices keep working.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not change the setting.' });
    }
  };

  const toggleLogin = async (on: boolean) => {
    setMessage(null);
    try {
      const saved: Settings = await sensitive(() => api('PATCH', '/admin/api/settings', { requireLoginForCentralAi: on }));
      setForm(saved);
      setMessage({
        kind: 'success',
        text: on
          ? 'Sign-in is now required for Devora AI. Computers without an account keep local features and updates, and are asked to sign in.'
          : 'Devora AI works without an account again.',
      });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not change the setting.' });
    }
  };

  const toggleDirect = async (on: boolean) => {
    setMessage(null);
    try {
      const saved: Settings = await sensitive(() => api('PATCH', '/admin/api/settings', { allowDirectProvider: on }));
      setForm(saved);
      setMessage({ kind: 'success', text: on ? 'Direct-provider mode is allowed for owner-only testing. Keep it off in production.' : 'Direct-provider mode is off.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not change the setting.' });
    }
  };

  /** Downloads the configuration backup as a JSON file. Secrets are never part of the export. */
  const downloadExport = async () => {
    setMessage(null);
    try {
      const data = await api<Record<string, unknown>>('GET', '/admin/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `devora-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage({ kind: 'success', text: 'Configuration downloaded. The export never contains key material, hashes or tokens.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not create the export.' });
    }
  };

  return (
    <Page title="Settings" intro="Limits that protect the service and the providers' budgets.">
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Card title="Limits">
        <form onSubmit={save} className="form">
          <Field label="Requests per device per minute" hint="1 to 600.">
            <input type="number" min={1} max={600} value={form.rateLimitPerMinute} onChange={(e) => setForm({ ...form, rateLimitPerMinute: Number(e.target.value) })} />
          </Field>
          <Field label="Parallel requests per device" hint="1 to 16.">
            <input type="number" min={1} max={16} value={form.maxConcurrentPerDevice} onChange={(e) => setForm({ ...form, maxConcurrentPerDevice: Number(e.target.value) })} />
          </Field>
          <Field label="Maximum output tokens per request" hint="1 to 32768. Requests asking for more are refused.">
            <input type="number" min={1} max={32768} value={form.maxOutputTokens} onChange={(e) => setForm({ ...form, maxOutputTokens: Number(e.target.value) })} />
          </Field>
          <Field label="Web searches per device per minute" hint="1 to 120. Protects your search provider quota.">
            <input type="number" min={1} max={120} value={form.searchPerMinute ?? 20} onChange={(e) => setForm({ ...form, searchPerMinute: Number(e.target.value) })} />
          </Field>
          <Field label="Requests per API key per minute" hint="1 to 600. Applies to the keys on the API keys page.">
            <input type="number" min={1} max={600} value={form.apiKeyRateLimitPerMinute ?? 30} onChange={(e) => setForm({ ...form, apiKeyRateLimitPerMinute: Number(e.target.value) })} />
          </Field>
          <div className="form-actions">
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save limits'}</Button>
          </div>
        </form>
      </Card>

      <Card title="New computers">
        <p>Desktop apps connect on their own the first time they open. Turn this off to stop new computers from connecting, for example if the app was shared too widely. Computers already listed under Devices keep working, and you can block any of them.</p>
        <label className="check">
          <input type="checkbox" checked={form.allowAutoRegistration} onChange={(e) => toggleRegistration(e.target.checked)} /> Allow new computers to connect
        </label>
      </Card>

      <Card title="Devora accounts">
        {form.accountsConfigured ? (
          <p>
            People can sign in to the desktop app with email and password, Google or GitHub (whichever are enabled in PocketBase). With the option below
            <strong> off</strong>, sign-in is optional and every computer keeps working as before. With it <strong>on</strong>, the server refuses central AI
            (chat, models, memory sync, usage) to computers without a signed-in, verified account. Local work and app updates are never blocked. Changing it
            asks for your password.
          </p>
        ) : (
          <p className="muted">Accounts are not set up on this server (POCKETBASE_URL and the PocketBase superuser are missing), so sign-in cannot be required.</p>
        )}
        <label className="check">
          <input type="checkbox" checked={form.requireLoginForCentralAi} disabled={!form.accountsConfigured && !form.requireLoginForCentralAi} onChange={(e) => toggleLogin(e.target.checked)} /> Require sign-in for Devora AI
        </label>
      </Card>

      <Card title="Direct-provider mode (owner only)">
        <p>
          Lets the desktop call providers directly with keys stored on that computer. It exists only as a migration and rollback option while the central
          routing is being verified. It is <strong>off</strong> by default. Ordinary desktop users never see it, and changing it asks for your password.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={form.allowDirectProvider}
            onChange={(e) => toggleDirect(e.target.checked)}
            aria-describedby="direct-note"
          />{' '}
          Allow direct-provider mode for the owner
        </label>
        <p id="direct-note" className="muted small">Turn it off again once the migration or rollback is finished.</p>
      </Card>

      <Card title="Configuration backup">
        <p>
          Downloads everything you configured here as one JSON file: providers, models, devices (names only), agents, skills, announcements, search
          providers, API key metadata and the server settings. The export is safe to keep: provider API keys, key hashes, tokens and passwords are
          never included. Keep a fresh copy before big changes, for example before moving to a new server.
        </p>
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
          <Button onClick={() => void downloadExport()}>Download configuration (JSON)</Button>
        </div>
      </Card>
    </Page>
  );
}
