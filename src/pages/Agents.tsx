// Organization agents: presets the owner writes here and every desktop's agent system receives (GET /v1/agents).
// An agent describes how to do a kind of work (its instructions), the access level it may run with and, optionally,
// the model it suits best. Access levels mirror the desktop's own subagent levels and can only narrow, never widen,
// what a desktop already allows.
import { useState, type FormEvent } from 'react';
import { api, ApiError, when } from '../api.ts';
import { Badge, Button, Field, Modal, Notice, Page, Table, useLoad } from '../ui.tsx';

interface OrgAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  access: string;
  suggestedModel: string | null;
  enabled: boolean;
  revision: number;
  updatedAt: string;
}
interface Limits {
  name: number;
  description: number;
  instructions: number;
  suggestedModel: number;
}
interface Template {
  name: string;
  description: string;
  instructions: string;
  access: string;
  suggestedModel: string | null;
}

const ACCESS_HELP: Record<string, string> = {
  read: 'Read-only: inspect the project, never change anything.',
  commands: 'Read-only plus running commands (tests, builds).',
  docs: 'Read-only plus editing documentation files.',
  write: 'Read-only plus editing the paths it was given.',
  write_commands: 'Editing plus commands; the desktop still asks per its approval policy.',
};

const TEMPLATE = `You handle one kind of work. Follow these steps:

1. ...
2. ...

Rules:
- ...`;

export function Agents() {
  const { data, error, reload } = useLoad<{ agents: OrgAgent[]; version: number; limits: Limits; accessLevels: string[]; templates: Template[] }>(() => api('GET', '/admin/api/agents'));
  const [editing, setEditing] = useState<OrgAgent | 'new' | null>(null);
  const [deleting, setDeleting] = useState<OrgAgent | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const toggle = async (a: OrgAgent) => {
    setMessage(null);
    try {
      await api('PATCH', `/admin/api/agents/${a.id}`, { enabled: !a.enabled });
      setMessage({ kind: 'success', text: a.enabled ? `${a.name} is off for every desktop.` : `${a.name} is on. Desktops get it on their next sync (within 5 minutes).` });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not change the agent.' });
    }
  };

  const agents = data?.agents ?? [];
  return (
    <Page
      title="Agents"
      intro="Agent presets you publish to every desktop: how the agent approaches a kind of task, and the least access it needs. Users always see which organization agents ran and can turn one off for themselves. An agent preset never grants more access than the desktop already allows."
      actions={<Button variant="primary" onClick={() => setEditing('new')}>New agent</Button>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Table head={['Agent', 'Access', 'Status', 'Updated', 'Actions']} rows={agents.length} empty="No organization agents yet. Write one for a kind of work your team repeats, for example “Release notes writer” or “Dependency updater”.">
        {agents.map((a) => (
          <tr key={a.id}>
            <td>
              <strong>{a.name}</strong>
              <div className="small muted">{a.description}</div>
              {a.suggestedModel && <div className="small muted">Suggested model: <span className="mono">{a.suggestedModel}</span></div>}
            </td>
            <td>
              <Badge tone={a.access === 'read' || a.access === 'docs' ? 'ok' : 'warn'}>{a.access}</Badge>
            </td>
            <td>{a.enabled ? <Badge tone="ok">on</Badge> : <Badge tone="muted">off</Badge>}</td>
            <td className="small">{when(a.updatedAt)} <span className="muted">· v{a.revision}</span></td>
            <td className="actions">
              <Button small onClick={() => setEditing(a)}>Edit</Button>
              <Button small onClick={() => void toggle(a)}>{a.enabled ? 'Turn off' : 'Turn on'}</Button>
              <Button small variant="danger" onClick={() => setDeleting(a)}>Delete</Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && data ? (
        <AgentEditor
          agent={editing === 'new' ? null : editing}
          limits={data.limits}
          accessLevels={data.accessLevels}
          templates={data.templates ?? []}
          onClose={() => setEditing(null)}
          onDone={(name, created) => {
            setEditing(null);
            setMessage({ kind: 'success', text: `${name} ${created ? 'published' : 'saved'}. Desktops get it on their next sync (within 5 minutes).` });
            reload();
          }}
        />
      ) : null}
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
                  const a = deleting;
                  setDeleting(null);
                  try {
                    await api('DELETE', `/admin/api/agents/${a.id}`);
                    setMessage({ kind: 'success', text: `${a.name} deleted. It disappears from desktops on their next sync.` });
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
          <p>The agent preset is removed from every desktop on their next sync. Nothing a desktop already did with it changes.</p>
        </Modal>
      ) : null}
    </Page>
  );
}

function AgentEditor(props: { agent: OrgAgent | null; limits: Limits; accessLevels: string[]; templates: Template[]; onClose: () => void; onDone: (name: string, created: boolean) => void }) {
  const a = props.agent;
  const [name, setName] = useState(a?.name ?? '');
  const [description, setDescription] = useState(a?.description ?? '');
  const [instructions, setInstructions] = useState(a?.instructions ?? TEMPLATE);
  const [access, setAccess] = useState(a?.access ?? 'read');
  const [suggestedModel, setSuggestedModel] = useState(a?.suggestedModel ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const L = props.limits;
  const problems = [
    !name.trim() && 'Name is required.',
    name.length > L.name && `Name: at most ${L.name} characters.`,
    !description.trim() && 'Description is required (it says when this agent applies).',
    description.length > L.description && `Description: at most ${L.description} characters.`,
    !instructions.trim() && 'Instructions are required.',
    instructions.length > L.instructions && `Instructions: at most ${L.instructions} characters.`,
    suggestedModel.length > L.suggestedModel && `Suggested model: at most ${L.suggestedModel} characters.`,
  ].filter(Boolean) as string[];

  /** Fills the form from a ready-made preset (only for new agents; an edit never resets). */
  const applyTemplate = (slug: string) => {
    const t = props.templates.find((x) => x.name === slug);
    if (!t) return;
    setName(t.name);
    setDescription(t.description);
    setInstructions(t.instructions);
    setAccess(t.access);
    setSuggestedModel(t.suggestedModel ?? '');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim(), instructions, access, suggestedModel: suggestedModel.trim() || null };
      if (a) await api('PATCH', `/admin/api/agents/${a.id}`, body);
      else await api('POST', '/admin/api/agents', body);
      props.onDone(name.trim(), !a);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the agent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={a ? `Edit ${a.name}` : 'New agent'} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        {!a && props.templates.length > 0 && (
          <Field label="Start from a template" hint="Ready-made presets the server provides; every field can still be edited after.">
            <select value="" onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Choose a template…</option>
              {props.templates.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Name" hint="Short and specific, for example “Changelog writer”.">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={L.name} required />
        </Field>
        <Field label="Description" hint="When should an agent use this preset? One or two sentences.">
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={L.description} />
        </Field>
        <Field label={`Instructions (${instructions.length}/${L.instructions})`} hint="Plain language steps and rules for this kind of work. Markdown is fine.">
          <textarea rows={10} className="mono" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <Field label="Access level" hint={ACCESS_HELP[access]}>
          <select value={access} onChange={(e) => setAccess(e.target.value)}>
            {props.accessLevels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label={`Suggested model (optional, ≤ ${L.suggestedModel} characters)`} hint="A model name that suits this agent, for example a fast model for routine work. Desktops may ignore it.">
          <input value={suggestedModel} onChange={(e) => setSuggestedModel(e.target.value)} maxLength={L.suggestedModel} />
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
