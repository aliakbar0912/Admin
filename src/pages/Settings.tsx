import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, sensitive } from '../api.ts';
import { Button, Card, Field, Notice, Page, Spinner, useLoad } from '../ui.tsx';

interface Settings {
  rateLimitPerMinute: number;
  maxConcurrentPerDevice: number;
  maxOutputTokens: number;
  allowDirectProvider: boolean;
  allowAutoRegistration: boolean;
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
    </Page>
  );
}
