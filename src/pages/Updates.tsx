// Desktop app updates: create a release, upload the Windows installer (or link an https download), publish it, and follow
// the rollout. Desktop apps check every few hours, download in the background and install when the user restarts.
import { useState, type FormEvent } from 'react';
import { ago, api, ApiError, bytes, sensitive, uploadPiece } from '../api.ts';
import { Badge, Button, Card, Field, Modal, Notice, Page, Spinner, Table, useLoad } from '../ui.tsx';

interface Release {
  id: string;
  version: string;
  notes: string;
  mandatory: boolean;
  status: 'draft' | 'published';
  source: 'upload' | 'url';
  externalUrl: string | null;
  fileName: string;
  fileSize: number;
  sha256: string | null;
  uploadComplete: boolean;
  uploadedBytes: number;
  downloads: number;
  createdAt: string;
  publishedAt: string | null;
}

interface ReleasesData {
  releases: Release[];
  adoption: { version: string; devices: number }[];
  chunkBytes: number;
  maxBytes: number;
}

const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$/;

function nextVersion(list: Release[]): string {
  const v = list[0]?.version;
  if (!v) return '0.1.0';
  const [a, b, c] = v.split(/[-+]/)[0].split('.').map((x) => Number(x) || 0);
  return `${a}.${b}.${c + 1}`;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function Updates() {
  const { data, error, loading, reload } = useLoad<ReleasesData>(() => api('GET', '/admin/api/releases'));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Release | null>(null);
  const [removing, setRemoving] = useState<Release | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: 'success', text: ok });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Something went wrong.' });
    }
  };
  const patch = (r: Release, body: Record<string, unknown>) => sensitive(() => api('PATCH', `/admin/api/releases/${r.id}`, body));
  const latest = data?.releases.find((r) => r.status === 'published');
  const totalDevices = data?.adoption.reduce((n, a) => n + a.devices, 0) ?? 0;
  const onLatest = latest ? (data?.adoption.find((a) => a.version === latest.version)?.devices ?? 0) : 0;

  return (
    <Page
      title="Updates"
      intro="Publish new versions of the desktop app. Devora checks every few hours, downloads the update in the background and installs it when the user restarts. Required updates download on their own."
      actions={<Button variant="primary" onClick={() => setCreating(true)}>New release</Button>}
    >
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {loading && !data && <Spinner />}
      {data && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Latest published</div>
              <div className="stat-value">{latest ? latest.version : '—'}</div>
              <div className="stat-hint">{latest ? `released ${ago(latest.publishedAt)}${latest.mandatory ? ' · required' : ''}` : 'nothing published yet'}</div>
            </div>
            <div className="stat">
              <div className="stat-label">On the latest version</div>
              <div className="stat-value">{latest && totalDevices ? `${Math.round((onLatest / totalDevices) * 100)}%` : '—'}</div>
              <div className="stat-hint">{totalDevices ? `${onLatest} of ${totalDevices} active computers` : 'no active computers'}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Downloads</div>
              <div className="stat-value">{data.releases.reduce((n, r) => n + r.downloads, 0)}</div>
              <div className="stat-hint">all releases</div>
            </div>
          </div>

          <Table head={['Version', 'Status', 'Installer', 'Downloads', 'Released', '']} rows={data.releases.length} empty="No releases yet. Choose “New release” to publish the first update.">
            {data.releases.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.version}</strong>
                  {r.notes && <div className="muted small clamp">{r.notes.split('\n').find((l) => l.trim())?.replace(/^[#\-*\s]+/, '')}</div>}
                </td>
                <td>
                  <div className="badges">
                    {r.status === 'published' ? <Badge tone="ok">published</Badge> : r.uploadComplete ? <Badge>draft</Badge> : <Badge tone="warn">upload incomplete</Badge>}
                    {r.mandatory && <Badge tone="warn">required</Badge>}
                  </div>
                </td>
                <td className="small">
                  {r.source === 'url' ? (
                    <span className="mono" title={r.externalUrl ?? ''}>external link</span>
                  ) : (
                    <>
                      {bytes(r.fileSize || r.uploadedBytes)}
                      {r.sha256 && <div className="muted mono tiny" title={r.sha256}>SHA-256 {r.sha256.slice(0, 12)}…</div>}
                    </>
                  )}
                </td>
                <td>{r.downloads}</td>
                <td className="small">{r.publishedAt ? ago(r.publishedAt) : <span className="muted">not published</span>}</td>
                <td className="actions">
                  {r.status === 'published' ? (
                    <Button small onClick={() => void run(() => patch(r, { status: 'draft' }), `${r.version} is no longer offered.`)}>Unpublish</Button>
                  ) : (
                    <Button small variant="primary" disabled={!r.uploadComplete} onClick={() => void run(() => patch(r, { status: 'published' }), `${r.version} is published. Desktops will offer it within a few hours, or at once when the user checks.`)}>Publish</Button>
                  )}
                  <Button small onClick={() => void run(() => patch(r, { mandatory: !r.mandatory }), r.mandatory ? `${r.version} is optional now.` : `${r.version} is required now.`)}>{r.mandatory ? 'Make optional' : 'Make required'}</Button>
                  <Button small onClick={() => setEditing(r)}>Notes</Button>
                  <Button small variant="ghost" onClick={() => setRemoving(r)}>Delete</Button>
                </td>
              </tr>
            ))}
          </Table>

          <div className="two-col" style={{ marginTop: 16 }}>
            <Card title="Versions in use">
              {data.adoption.length === 0 ? (
                <p className="muted">No active computers yet.</p>
              ) : (
                <div className="bars">
                  {data.adoption.map((a) => (
                    <div key={a.version} className="bar-row">
                      <span className="bar-label mono">{a.version}{latest?.version === a.version ? ' (latest)' : ''}</span>
                      <span className="bar"><span style={{ width: `${Math.max(3, (a.devices / Math.max(1, totalDevices)) * 100)}%` }} /></span>
                      <span className="bar-value">{a.devices}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="muted small">“unknown” means the computer has not checked in since this server started recording versions.</p>
            </Card>
            <Card title="How updates reach users">
              <ol className="steps">
                <li>Build the installer with <span className="mono">npm run dist</span> (it is in the release folder, Devora-Setup-VERSION.exe).</li>
                <li>Create a release with the same version as package.json and upload the .exe, or link an https download with its SHA-256.</li>
                <li>Publish. Users see “Update” in the title bar; required updates download by themselves.</li>
                <li>The app checks the file’s SHA-256 before installing, then restarts on the new version.</li>
              </ol>
            </Card>
          </div>
        </>
      )}
      {creating && data && (
        <NewRelease
          suggested={nextVersion(data.releases)}
          chunkBytes={data.chunkBytes}
          maxBytes={data.maxBytes}
          onClose={() => setCreating(false)}
          onDone={(text) => {
            setCreating(false);
            setMessage({ kind: 'success', text });
            reload();
          }}
        />
      )}
      {editing && (
        <NotesDialog
          release={editing}
          onClose={() => setEditing(null)}
          onSave={(notes) => {
            const r = editing;
            setEditing(null);
            void run(() => api('PATCH', `/admin/api/releases/${r.id}`, { notes }), `Notes for ${r.version} saved.`);
          }}
        />
      )}
      {removing && (
        <Modal
          title={`Delete ${removing.version}?`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button onClick={() => setRemoving(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const r = removing;
                  setRemoving(null);
                  void run(() => sensitive(() => api('DELETE', `/admin/api/releases/${r.id}`)), `${r.version} was deleted.`);
                }}
              >
                Delete release
              </Button>
            </>
          }
        >
          <p>{removing.status === 'published' ? 'Desktops will stop being offered this version. Computers that already installed it keep it.' : 'The draft and its uploaded installer are removed.'}</p>
        </Modal>
      )}
    </Page>
  );
}

function NewRelease(props: { suggested: string; chunkBytes: number; maxBytes: number; onClose: () => void; onDone: (text: string) => void }) {
  const [version, setVersion] = useState(props.suggested);
  const [notes, setNotes] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [publish, setPublish] = useState(true);
  const [source, setSource] = useState<'upload' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [sha, setSha] = useState('');
  const [phase, setPhase] = useState('');
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const busy = !!phase;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!VERSION.test(version)) return setError('Use a version like 1.2.3 (the same as package.json).');
    if (source === 'upload') {
      if (!file) return setError('Choose the installer (.exe).');
      if (!/\.exe$/i.test(file.name)) return setError('Choose the Windows installer, a .exe file.');
      if (file.size > props.maxBytes) return setError(`The installer may be at most ${bytes(props.maxBytes)}.`);
    } else if (!/^https:\/\//.test(url) || !/^[0-9a-fA-F]{64}$/.test(sha.trim())) return setError('Give an https download address and the installer’s SHA-256 (64 hex characters).');
    let id = '';
    try {
      setPhase('Creating the release…');
      const created = await api<{ release: { id: string } }>(
        'POST',
        '/admin/api/releases',
        source === 'upload' ? { version, notes, mandatory, fileName: file!.name.replace(/[^A-Za-z0-9 ._()+-]/g, '_').slice(0, 200), fileSize: file!.size } : { version, notes, mandatory, externalUrl: url.trim(), sha256: sha.trim().toLowerCase() },
      );
      id = created.release.id;
      if (source === 'upload') {
        setPhase('Checking the file…');
        const digest = await sha256Hex(file!);
        const pieces = Math.ceil(file!.size / props.chunkBytes);
        for (let i = 0; i < pieces; i++) {
          setPhase(`Uploading ${bytes(Math.min(file!.size, (i + 1) * props.chunkBytes))} of ${bytes(file!.size)}…`);
          const piece = file!.slice(i * props.chunkBytes, (i + 1) * props.chunkBytes);
          for (let attempt = 1; ; attempt++) {
            try {
              await uploadPiece(`/admin/api/releases/${id}/chunks/${i}`, piece);
              break;
            } catch (err) {
              if (attempt >= 3 || (err instanceof ApiError && err.status >= 400 && err.status < 500)) throw err;
              await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
          }
          setPct(Math.round(((i + 1) / pieces) * 100));
        }
        setPhase('Verifying…');
        await api('POST', `/admin/api/releases/${id}/complete`, { sha256: digest });
      }
      if (publish) {
        setPhase('Publishing…');
        await sensitive(() => api('PATCH', `/admin/api/releases/${id}`, { status: 'published' }));
      }
      props.onDone(publish ? `${version} is published. Desktops will offer it within a few hours, or at once when the user checks.` : `${version} is saved as a draft. Publish it when you are ready.`);
    } catch (err) {
      setPhase('');
      setPct(0);
      setError(`${err instanceof ApiError ? err.message : 'The release could not be created.'}${id ? ' The draft was kept; you can delete it and try again.' : ''}`);
    }
  };

  return (
    <Modal title="New release" onClose={() => !busy && props.onClose()}>
      <form className="form" onSubmit={submit}>
        <Field label="Version" hint="Must be higher than the installed version, and match the installer (package.json version).">
          <input value={version} onChange={(e) => setVersion(e.target.value.trim())} required disabled={busy} />
        </Field>
        <Field label="What's new" hint="Shown to users before they update. Markdown is supported.">
          <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} placeholder={'- Faster agent\n- Fixed the terminal on Windows 11'} />
        </Field>
        <div className="segmented" role="radiogroup" aria-label="Installer source">
          <button type="button" role="radio" aria-checked={source === 'upload'} className={`seg${source === 'upload' ? ' seg-on' : ''}`} onClick={() => setSource('upload')} disabled={busy}>Upload installer</button>
          <button type="button" role="radio" aria-checked={source === 'url'} className={`seg${source === 'url' ? ' seg-on' : ''}`} onClick={() => setSource('url')} disabled={busy}>Download link</button>
        </div>
        {source === 'upload' ? (
          <Field label="Installer (.exe)" hint={`Up to ${bytes(props.maxBytes)}. Stored on your server and checked with SHA-256.`}>
            <input type="file" accept=".exe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
          </Field>
        ) : (
          <>
            <Field label="Download address" hint="An https link to the installer, for example a GitHub release asset.">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://downloads.YOUR_DOMAIN/Devora-Setup-1.2.3.exe" disabled={busy} />
            </Field>
            <Field label="SHA-256 of the installer" hint="Desktops refuse a download that does not match. PowerShell: Get-FileHash .\Devora-Setup-1.2.3.exe">
              <input className="mono" value={sha} onChange={(e) => setSha(e.target.value)} disabled={busy} />
            </Field>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} disabled={busy} /> Required update (downloads automatically and is shown as required)
        </label>
        <label className="check">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} disabled={busy} /> Publish now
        </label>
        {phase && (
          <div className="progress-block" role="status">
            <div className="small">{phase}</div>
            {pct > 0 && <div className="bar big"><span style={{ width: `${pct}%` }} /></div>}
          </div>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{publish ? 'Create and publish' : 'Create draft'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function NotesDialog(props: { release: Release; onClose: () => void; onSave: (notes: string) => void }) {
  const [notes, setNotes] = useState(props.release.notes);
  return (
    <Modal title={`What's new in ${props.release.version}`} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSave(notes);
        }}
      >
        <Field label="Release notes" hint="Markdown is supported. Users see the new text the next time Devora checks.">
          <textarea rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save notes</Button>
        </div>
      </form>
    </Modal>
  );
}
