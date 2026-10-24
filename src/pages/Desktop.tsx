// Desktop announcement: what every desktop app is told through GET /v1/client-config. The values here are stored in
// the database and override the server's DEVORA_DESKTOP_* environment settings; an empty value falls back to the
// environment. Raising the minimum version asks for a password confirmation, because it can lock older desktops out
// of central AI until they update.
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api.ts';
import { Badge, Button, Card, Field, Notice, Page, Spinner, useLoad } from '../ui.tsx';

interface DesktopConfig {
  statusMessage: string;
  minVersion: string;
  downloadUrl: string;
  maintenance: boolean;
}
interface DesktopConfigResponse extends DesktopConfig {
  environment: {
    minVersion: string | null;
    latestVersion: string | null;
    downloadUrl: string | null;
    statusMessage: string;
  };
}

export function Desktop() {
  const { data, error, loading, reload } = useLoad<DesktopConfigResponse>(() => api('GET', '/admin/api/desktop-config'));
  return (
    <Page
      title="Desktop"
      intro="What every installed Devora app is told the next time it checks in (within about 6 hours, or at restart). Use this for planned-maintenance notices, a download page move or to retire an old version. Nothing here can weaken a desktop's security: updates are only ever announced, never installed from here."
    >
      {loading && !data && <Spinner />}
      {error && <Notice kind="error">{error}</Notice>}
      {data && <ConfigForm initial={data} onSaved={() => reload()} />}
      <Card title="How desktops use this">
        <ul className="plain-list small">
          <li><strong>Status message</strong> is shown as a notice inside the app, for example “Maintenance Sunday 02:00–03:00 UTC”.</li>
          <li><strong>Minimum version</strong> makes older apps show an update-required notice; they keep local features but stop calling central AI.</li>
          <li><strong>Download URL</strong> is the https page the app sends users to for the installer. It only changes where users download, never what is installed.</li>
          <li><strong>Maintenance</strong> tells apps to say the service is briefly unavailable, without changing anything else.</li>
          <li>Published releases (Updates page) always also announce their latest and required versions; the strongest rule wins.</li>
        </ul>
      </Card>
    </Page>
  );
}

function ConfigForm(props: { initial: DesktopConfigResponse; onSaved: () => void }) {
  const d = props.initial;
  const [statusMessage, setStatusMessage] = useState(d.statusMessage);
  const [minVersion, setMinVersion] = useState(d.minVersion);
  const [downloadUrl, setDownloadUrl] = useState(d.downloadUrl);
  const [maintenance, setMaintenance] = useState(d.maintenance);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const versionOk = minVersion === '' || /^\d+\.\d+\.\d+$/.test(minVersion);
  const downloadOk = downloadUrl === '' || /^https:\/\/[^\s]+$/.test(downloadUrl);
  const problems = [
    !versionOk && 'Minimum version must look like 1.2.3, or be empty.',
    !downloadOk && 'Download URL must be an https URL, or empty.',
  ].filter(Boolean) as string[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setMessage(null);
    try {
      await api('PATCH', '/admin/api/desktop-config', { statusMessage, minVersion, downloadUrl, maintenance });
      setMessage({ kind: 'success', text: 'Saved. Desktops pick this up on their next check (within about 6 hours).' });
      props.onSaved();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Announcement">
      <form className="form" onSubmit={submit}>
        <Field label={`Status message (${statusMessage.length}/200)`} hint={`Shown as a notice in every app. ${d.environment.statusMessage ? `Environment value: “${d.environment.statusMessage}”. An empty message falls back to it.` : 'Leave empty for none.'}`}>
          <textarea rows={2} maxLength={200} value={statusMessage} onChange={(e) => setStatusMessage(e.target.value)} />
        </Field>
        <Field label="Minimum version" hint={`Oldest version that may still use central AI. ${d.environment.minVersion ? `Environment value: ${d.environment.minVersion}. ` : ''}Changing this asks for your password.`}>
          <input value={minVersion} onChange={(e) => setMinVersion(e.target.value)} placeholder="1.2.3" className="mono" />
        </Field>
        <Field label="Download URL" hint={d.environment.downloadUrl ? `Environment value: ${d.environment.downloadUrl}` : 'The https page users download the installer from.'}>
          <input value={downloadUrl} onChange={(e) => setDownloadUrl(e.target.value)} placeholder="https://www.YOUR_DOMAIN/download" className="mono" />
        </Field>
        <Field label="Maintenance" hint="A short-service notice; nothing else changes.">
          <label className="check">
            <input type="checkbox" checked={maintenance} onChange={(e) => setMaintenance(e.target.checked)} />
            Desktops show a maintenance notice
          </label>
        </Field>
        <div className="small muted">
          Latest published release: {d.environment.latestVersion ? <><Badge tone="ok">{d.environment.latestVersion}</Badge></> : 'none yet'}
        </div>
        {problems.length ? <Notice kind="info">{problems.join(' ')}</Notice> : null}
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <div className="form-actions">
          <Button type="submit" variant="primary" disabled={busy || problems.length > 0}>{busy ? 'Saving…' : 'Save announcement'}</Button>
        </div>
      </form>
    </Card>
  );
}
