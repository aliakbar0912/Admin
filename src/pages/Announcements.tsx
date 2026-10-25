// Organization announcements: short notices the owner publishes here and every desktop shows to its user
// (GET /v1/announcements). A level says how loudly the desktop presents it: info for routine news, warning for
// things the user should act on, critical for urgent notices. Only enabled announcements reach desktops, and they
// pick the list up on their next sync (within about a minute).
import { useState, type FormEvent } from 'react';
import { api, ApiError, when } from '../api.ts';
import { Badge, Button, Field, Modal, Notice, Page, Table, useLoad } from '../ui.tsx';

interface Announcement {
  id: string;
  slug: string;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
  enabled: boolean;
  revision: number;
  updatedAt: string;
}
interface Limits {
  title: number;
  body: number;
}

const LEVEL_HELP: Record<string, string> = {
  info: 'Routine news: a new feature, a tip, a planned change.',
  warning: 'Something the user should act on: an update needed, an incident.',
  critical: 'Urgent only: the desktop presents it prominently.',
};

const LEVEL_TONE: Record<string, 'ok' | 'warn' | 'bad'> = { info: 'ok', warning: 'warn', critical: 'bad' };

const STARTER = `Write the notice here. Plain text or markdown, two or three sentences:

- What is happening.
- What (if anything) the user should do.
- Until when.`;

export function Announcements() {
  const { data, error, reload } = useLoad<{ announcements: Announcement[]; version: number; limits: Limits; levels: string[] }>(() => api('GET', '/admin/api/announcements'));
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const toggle = async (a: Announcement) => {
    setMessage(null);
    try {
      await api('PATCH', `/admin/api/announcements/${a.id}`, { enabled: !a.enabled });
      setMessage({ kind: 'success', text: a.enabled ? `${a.title} is hidden from desktops.` : `${a.title} is live. Desktops show it on their next sync (within about a minute).` });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not change the announcement.' });
    }
  };

  const list = data?.announcements ?? [];
  const live = list.filter((a) => a.enabled).length;
  return (
    <Page
      title="Announcements"
      intro={`Notices you publish to every desktop: maintenance windows, new features, urgent warnings. Desktops show them the next time they sync (${live} live now). A critical announcement is presented prominently; use it rarely.`}
      actions={<Button variant="primary" onClick={() => setEditing('new')}>New announcement</Button>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Table head={['Announcement', 'Level', 'Status', 'Updated', 'Actions']} rows={list.length} empty="No announcements yet. Write one for a planned maintenance window or a new feature your team should know about.">
        {list.map((a) => (
          <tr key={a.id}>
            <td>
              <strong>{a.title}</strong>
              <div className="small muted">{a.body.length > 140 ? `${a.body.slice(0, 140)}…` : a.body}</div>
            </td>
            <td>
              <Badge tone={LEVEL_TONE[a.level] ?? 'muted'}>{a.level}</Badge>
            </td>
            <td>{a.enabled ? <Badge tone="ok">live</Badge> : <Badge tone="muted">hidden</Badge>}</td>
            <td className="small">{when(a.updatedAt)} <span className="muted">· v{a.revision}</span></td>
            <td className="actions">
              <Button small onClick={() => setEditing(a)}>Edit</Button>
              <Button small onClick={() => void toggle(a)}>{a.enabled ? 'Hide' : 'Publish'}</Button>
              <Button small variant="danger" onClick={() => setDeleting(a)}>Delete</Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && data ? (
        <AnnouncementEditor
          announcement={editing === 'new' ? null : editing}
          limits={data.limits}
          levels={data.levels}
          onClose={() => setEditing(null)}
          onDone={(title, created) => {
            setEditing(null);
            setMessage({ kind: 'success', text: `${title} ${created ? 'published' : 'saved'}. Desktops pick it up on their next sync (within about a minute).` });
            reload();
          }}
        />
      ) : null}
      {deleting ? (
        <Modal
          title={`Delete “${deleting.title}”?`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const a = deleting;
                  setDeleting(null);
                  try {
                    await api('DELETE', `/admin/api/announcements/${a.id}`);
                    setMessage({ kind: 'success', text: `${a.title} deleted. It disappears from desktops on their next sync.` });
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
          <p>The notice is removed from every desktop on their next sync. This cannot be undone.</p>
        </Modal>
      ) : null}
    </Page>
  );
}

function AnnouncementEditor(props: { announcement: Announcement | null; limits: Limits; levels: string[]; onClose: () => void; onDone: (title: string, created: boolean) => void }) {
  const a = props.announcement;
  const [title, setTitle] = useState(a?.title ?? '');
  const [body, setBody] = useState(a?.body ?? STARTER);
  const [level, setLevel] = useState<'info' | 'warning' | 'critical'>(a?.level ?? 'info');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const L = props.limits;
  const problems = [
    !title.trim() && 'Title is required.',
    title.length > L.title && `Title: at most ${L.title} characters.`,
    /[\r\n]/.test(title) && 'The title must be a single line.',
    !body.trim() && 'Body is required.',
    body.length > L.body && `Body: at most ${L.body} characters.`,
  ].filter(Boolean) as string[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError('');
    try {
      const payload = { title: title.trim(), body, level };
      if (a) await api('PATCH', `/admin/api/announcements/${a.id}`, payload);
      else await api('POST', '/admin/api/announcements', payload);
      props.onDone(title.trim(), !a);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the announcement.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={a ? `Edit ${a.title}` : 'New announcement'} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Title" hint="One line, shown as the heading, for example “Maintenance tonight 02:00–03:00 UTC”.">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={L.title} required />
        </Field>
        <Field label="Level" hint={LEVEL_HELP[level]}>
          <select value={level} onChange={(e) => setLevel(e.target.value as 'info' | 'warning' | 'critical')}>
            {props.levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label={`Body (${body.length}/${L.body})`} hint="What is happening and what the user should do. Plain text or markdown.">
          <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {problems.length ? <Notice kind="info">{problems.join(' ')}</Notice> : null}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || problems.length > 0}>{busy ? 'Saving…' : a ? 'Save' : 'Publish to desktops'}</Button>
        </div>
      </form>
    </Modal>
  );
}
