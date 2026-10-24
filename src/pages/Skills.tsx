// Organization skills: written here, delivered to every desktop's agent as "Organization" skills. The format matches
// SKILL.md on the desktop (name, description, triggers, instructions, examples) with the same limits.
import { useState, type FormEvent } from 'react';
import { api, ApiError, when } from '../api.ts';
import { Badge, Button, Field, Modal, Notice, Page, Table, useLoad } from '../ui.tsx';

interface OrgSkill {
  id: string;
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  examples: string;
  enabled: boolean;
  revision: number;
  updatedAt: string;
}
interface Limits {
  name: number;
  description: number;
  trigger: number;
  triggers: number;
  instructions: number;
  examples: number;
}

const TEMPLATE = `Follow these steps:

1. ...
2. ...

Rules:
- ...`;

export function Skills() {
  const { data, error, reload } = useLoad<{ skills: OrgSkill[]; version: number; limits: Limits }>(() => api('GET', '/admin/api/skills'));
  const [editing, setEditing] = useState<OrgSkill | 'new' | null>(null);
  const [deleting, setDeleting] = useState<OrgSkill | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const toggle = async (s: OrgSkill) => {
    setMessage(null);
    try {
      await api('PATCH', `/admin/api/skills/${s.id}`, { enabled: !s.enabled });
      setMessage({ kind: 'success', text: s.enabled ? `${s.name} is off for every desktop.` : `${s.name} is on. Desktops get it on their next sync (within 5 minutes).` });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not change the skill.' });
    }
  };

  const skills = data?.skills ?? [];
  return (
    <Page
      title="Skills"
      intro="Skills you write here reach the agent on every desktop as Organization skills, within about 5 minutes. Users can turn one off for themselves but cannot edit it. A skill tells the agent how to do a kind of task; it never grants extra permissions."
      actions={<Button variant="primary" onClick={() => setEditing('new')}>New skill</Button>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <Table head={['Skill', 'Triggers', 'Status', 'Updated', 'Actions']} rows={skills.length} empty="No organization skills yet. Write one for your team's conventions, review checklist or release steps.">
        {skills.map((s) => (
          <tr key={s.id}>
            <td>
              <strong>{s.name}</strong>
              <div className="small muted">{s.description}</div>
            </td>
            <td className="small">{s.triggers.length ? s.triggers.join(', ') : <span className="muted">—</span>}</td>
            <td>{s.enabled ? <Badge tone="ok">on</Badge> : <Badge tone="muted">off</Badge>}</td>
            <td className="small">{when(s.updatedAt)} <span className="muted">· v{s.revision}</span></td>
            <td className="actions">
              <Button small onClick={() => setEditing(s)}>Edit</Button>
              <Button small onClick={() => void toggle(s)}>{s.enabled ? 'Turn off' : 'Turn on'}</Button>
              <Button small variant="danger" onClick={() => setDeleting(s)}>Delete</Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && data ? (
        <SkillEditor
          skill={editing === 'new' ? null : editing}
          limits={data.limits}
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
                  const s = deleting;
                  setDeleting(null);
                  try {
                    await api('DELETE', `/admin/api/skills/${s.id}`);
                    setMessage({ kind: 'success', text: `${s.name} deleted. It disappears from desktops on their next sync.` });
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
          <p>The skill is removed from every desktop on their next sync. Copies users made for themselves stay.</p>
        </Modal>
      ) : null}
    </Page>
  );
}

function SkillEditor(props: { skill: OrgSkill | null; limits: Limits; onClose: () => void; onDone: (name: string, created: boolean) => void }) {
  const s = props.skill;
  const [name, setName] = useState(s?.name ?? '');
  const [description, setDescription] = useState(s?.description ?? '');
  const [triggers, setTriggers] = useState((s?.triggers ?? []).join(', '));
  const [instructions, setInstructions] = useState(s?.instructions ?? TEMPLATE);
  const [examples, setExamples] = useState(s?.examples ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const L = props.limits;
  const triggerList = triggers.split(',').map((t) => t.trim()).filter(Boolean);
  const problems = [
    !name.trim() && 'Name is required.',
    name.length > L.name && `Name: at most ${L.name} characters.`,
    !description.trim() && 'Description is required (the agent uses it to decide when the skill applies).',
    description.length > L.description && `Description: at most ${L.description} characters.`,
    !instructions.trim() && 'Instructions are required.',
    instructions.length > L.instructions && `Instructions: at most ${L.instructions} characters.`,
    examples.length > L.examples && `Examples: at most ${L.examples} characters.`,
    triggerList.length > L.triggers && `At most ${L.triggers} triggers.`,
    triggerList.some((t) => t.length > L.trigger) && `Each trigger: at most ${L.trigger} characters.`,
  ].filter(Boolean) as string[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim(), triggers: triggerList, instructions, examples };
      if (s) await api('PATCH', `/admin/api/skills/${s.id}`, body);
      else await api('POST', '/admin/api/skills', body);
      props.onDone(name.trim(), !s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the skill.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={s ? `Edit ${s.name}` : 'New skill'} onClose={props.onClose}>
      <form className="form skill-form" onSubmit={submit}>
        <Field label="Name" hint="Short and specific, for example “Release checklist”.">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={L.name} required />
        </Field>
        <Field label="Description" hint="When should the agent use this skill? One or two sentences.">
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={L.description} />
        </Field>
        <Field label="Triggers" hint="Comma-separated words that suggest this skill, for example: release, deploy, changelog.">
          <input value={triggers} onChange={(e) => setTriggers(e.target.value)} />
        </Field>
        <Field label={`Instructions (${instructions.length}/${L.instructions})`} hint="Plain language steps and rules. Markdown is fine.">
          <textarea rows={12} className="mono" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <Field label={`Examples (optional, ${examples.length}/${L.examples})`}>
          <textarea rows={5} className="mono" value={examples} onChange={(e) => setExamples(e.target.value)} />
        </Field>
        {problems.length ? <Notice kind="info">{problems.join(' ')}</Notice> : null}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || problems.length > 0}>{busy ? 'Saving…' : s ? 'Save' : 'Publish to desktops'}</Button>
        </div>
      </form>
    </Modal>
  );
}
