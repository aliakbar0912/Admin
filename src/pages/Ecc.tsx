// Devora Library (the bundled library formerly labelled "ECC"): browse the library (agents, commands, skills,
// rules, hooks, workflows, contexts) and publish selected items to the organization, so every desktop receives
// them through the normal org sync (Skills and Agents pages). Every kind converts to a Devora entry: agents
// publish as organization agents; skills, commands, rules, hooks, workflows and context packs publish as
// organization skills — commands named "Devora /", rules "Devora Rule /", hooks "Devora Hook /" (guidance
// checklists), workflows "Devora Workflow /" (phase plans) and contexts "Devora Context /" (operating modes).
// Nothing in the library is ever executed.
import { useMemo, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { Badge, Button, Card, Notice, Page, Stat, Table, useLoad } from '../ui.tsx';

interface AgentItem {
  kind: 'agent';
  slug: string;
  name: string;
  description: string;
  tools: string[];
  model: string | null;
  access: string;
}
interface CommandItem {
  kind: 'command';
  slug: string;
  name: string;
  description: string;
  argumentHint: string;
}
interface SkillItem {
  kind: 'skill';
  slug: string;
  name: string;
  description: string;
  location: string;
}
interface RuleItem {
  kind: 'rule';
  slug: string;
  name: string;
  description: string;
  category: string;
  paths: string[];
}
interface HookItem {
  kind: 'hook';
  slug: string;
  name: string;
  description: string;
  event: string;
}
interface WorkflowItem {
  kind: 'workflow';
  slug: string;
  name: string;
  description: string;
  phases: string[];
}
interface ContextItem {
  kind: 'context';
  slug: string;
  name: string;
  description: string;
}
type Item = AgentItem | CommandItem | SkillItem | RuleItem | HookItem | WorkflowItem | ContextItem;

interface Catalog {
  version: string;
  counts: { agents: number; commands: number; skills: number; rules: number; hooks: number; workflows: number; contexts: number };
  agents: AgentItem[];
  commands: CommandItem[];
  skills: SkillItem[];
  rules: RuleItem[];
  hooks: HookItem[];
  workflows: WorkflowItem[];
  contexts: ContextItem[];
}

type Tab = 'agents' | 'commands' | 'skills' | 'rules' | 'hooks' | 'workflows' | 'contexts';

const ACCESS_TONE: Record<string, 'ok' | 'warn' | 'muted'> = {
  read: 'muted',
  commands: 'warn',
  docs: 'warn',
  write: 'warn',
  write_commands: 'ok',
};

export function Ecc() {
  const { data, error, reload, loading } = useLoad<Catalog>(() => api('GET', '/admin/api/ecc/catalog'));
  const [tab, setTab] = useState<Tab>('agents');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const items: Item[] = useMemo(() => {
    if (!data) return [];
    const all: Item[] = [...data.agents, ...data.commands, ...data.skills, ...data.rules, ...data.hooks, ...data.workflows, ...data.contexts];
    const q = query.trim().toLowerCase();
    const kind = tab === 'rules' ? 'rule' : tab === 'contexts' ? 'context' : tab.slice(0, -1);
    return filter(all.filter((i) => i.kind === kind), q);
  }, [data, tab, query]);

  const keyOf = (i: Item) => `${i.kind}:${i.slug}`;
  const pickedCount = picked.size;

  const toggle = (i: Item) => {
    setMessage(null);
    setPicked((prev) => {
      const next = new Set(prev);
      const k = keyOf(i);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const publish = async (all: boolean) => {
    if (!data) return;
    setBusy(true);
    setMessage(null);
    const agents = all ? data.agents.map((a) => a.slug) : [...picked].filter((k) => k.startsWith('agent:')).map((k) => k.slice(6));
    const skills = all ? data.skills.map((s) => s.slug) : [...picked].filter((k) => k.startsWith('skill:')).map((k) => k.slice(6));
    const commands = all ? data.commands.map((c) => c.slug) : [...picked].filter((k) => k.startsWith('command:')).map((k) => k.slice(8));
    const rules = all ? data.rules.map((r) => r.slug) : [...picked].filter((k) => k.startsWith('rule:')).map((k) => k.slice(5));
    const hooks = all ? data.hooks.map((h) => h.slug) : [...picked].filter((k) => k.startsWith('hook:')).map((k) => k.slice(5));
    const workflows = all ? data.workflows.map((w) => w.slug) : [...picked].filter((k) => k.startsWith('workflow:')).map((k) => k.slice(9));
    const contexts = all ? data.contexts.map((c) => c.slug) : [...picked].filter((k) => k.startsWith('context:')).map((k) => k.slice(8));
    try {
      const res = await api<{ published: { agents: number; skills: number; commands: number; rules: number; hooks: number; workflows: number; contexts: number } }>('POST', '/admin/api/ecc/publish', {
        ...(all ? { all: true } : { agents, skills, commands, rules, hooks, workflows, contexts }),
      });
      const p = res.published;
      const done = [
        p.agents ? `${p.agents} agents` : '',
        p.skills ? `${p.skills} skills` : '',
        p.commands ? `${p.commands} commands` : '',
        p.rules ? `${p.rules} rules` : '',
        p.hooks ? `${p.hooks} hooks` : '',
        p.workflows ? `${p.workflows} workflows` : '',
        p.contexts ? `${p.contexts} contexts` : '',
      ].filter(Boolean);
      setMessage({
        kind: 'success',
        text: `Published ${done.join(', ') || 'nothing'} to the organization. Desktops receive them on their next sync (within about 5 minutes).`,
      });
      setPicked(new Set());
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Publishing failed.' });
    } finally {
      setBusy(false);
    }
  };

  const unpublishAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ removed: { agents: number; skills: number } }>('POST', '/admin/api/ecc/unpublish', { all: true });
      setMessage({ kind: 'success', text: `Removed ${res.removed.agents} library agents and ${res.removed.skills} library skills/commands/rules from the organization.` });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Removing failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Devora Library"
      intro={`The bundled Devora library (v${data?.version ?? '—'}) ships with Devora: specialist agent presets, prompt commands, method skills, coding-standard rules, hook checklists, workflow plans and context packs. Publish any of them to convert them into organization skills and agents that every desktop receives; hooks and workflows arrive as advisory guidance and nothing in the library ever runs on its own.`}
      actions={
        <>
          <Button onClick={() => void unpublishAll()} disabled={busy}>Remove published</Button>
          <Button onClick={() => void publish(true)} disabled={busy || !data}>Publish all</Button>
          <Button variant="primary" onClick={() => void publish(false)} disabled={busy || pickedCount === 0}>
            Publish selected{pickedCount ? ` (${pickedCount})` : ''}
          </Button>
        </>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      {loading && !data && <Notice kind="info">Loading the Devora library…</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {data && (
        <>
          <div className="stats">
            <Stat label="Library version" value={`v${data.version}`} />
            <Stat label="Agents" value={data.counts.agents} hint="specialist presets" />
            <Stat label="Commands" value={data.counts.commands} hint="prompt templates" />
            <Stat label="Skills" value={data.counts.skills} hint="method notes" />
            <Stat label="Rules" value={data.counts.rules} hint="coding standards" />
            <Stat label="Hooks" value={data.counts.hooks} hint="checklist guidance" />
            <Stat label="Workflows" value={data.counts.workflows} hint="phase plans" />
            <Stat label="Contexts" value={data.counts.contexts} hint="operating modes" />
          </div>

          <Card title="Browse">
            <div className="row" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {(['agents', 'commands', 'skills', 'rules', 'hooks', 'workflows', 'contexts'] as Tab[]).map((t) => (
                <Button
                  key={t}
                  small
                  variant={tab === t ? 'primary' : 'secondary'}
                  onClick={() => {
                    setTab(t);
                    setMessage(null);
                  }}
                >
                  {t[0].toUpperCase() + t.slice(1)} ({data.counts[t]})
                </Button>
              ))}
              <input
                type="search"
                placeholder="Search by name or description…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: 1, minWidth: 200 }}
                aria-label="Search the Devora library"
              />
            </div>

            {tab === 'agents' && (
              <Table head={['', 'Agent', 'Access', 'Tools', 'Model']} rows={items.length} empty="No Devora library agents match.">
                {items.map((i) => {
                  const a = i as AgentItem;
                  return (
                    <tr key={keyOf(a)}>
                      <td><input type="checkbox" checked={picked.has(keyOf(a))} onChange={() => toggle(a)} aria-label={`Select ${a.name}`} /></td>
                      <td>
                        <strong>{a.name}</strong>
                        <div className="small muted">{a.description}</div>
                      </td>
                      <td><Badge tone={ACCESS_TONE[a.access] ?? 'muted'}>{a.access}</Badge></td>
                      <td className="small muted">{a.tools.slice(0, 6).join(', ') || '—'}</td>
                      <td className="small">{a.model ?? '—'}</td>
                    </tr>
                  );
                })}
              </Table>
            )}

            {tab === 'commands' && (
              <Table head={['', 'Command', 'Arguments']} rows={items.length} empty="No Devora library commands match.">
                {items.map((i) => {
                  const c = i as CommandItem;
                  return (
                    <tr key={keyOf(c)}>
                      <td><input type="checkbox" checked={picked.has(keyOf(c))} onChange={() => toggle(c)} aria-label={`Select ${c.name}`} /></td>
                      <td>
                        <strong>/{c.slug}</strong>
                        <div className="small muted">{c.description}</div>
                      </td>
                      <td className="small muted">{c.argumentHint || '—'}</td>
                    </tr>
                  );
                })}
              </Table>
            )}

            {tab === 'skills' && (
              <Table head={['', 'Skill', 'Location']} rows={items.length} empty="No Devora library skills match.">
                {items.map((i) => {
                  const s = i as SkillItem;
                  return (
                    <tr key={keyOf(s)}>
                      <td><input type="checkbox" checked={picked.has(keyOf(s))} onChange={() => toggle(s)} aria-label={`Select ${s.name}`} /></td>
                      <td>
                        <strong>{s.name}</strong>
                        <div className="small muted">{s.description}</div>
                      </td>
                      <td className="small muted">{s.location}</td>
                    </tr>
                  );
                })}
              </Table>
            )}

            {tab === 'rules' && (
              <Table head={['', 'Rule', 'Category', 'Paths']} rows={items.length} empty="No Devora library rules match.">
                {items.map((i) => {
                  const r = i as RuleItem;
                  return (
                    <tr key={keyOf(r)}>
                      <td><input type="checkbox" checked={picked.has(keyOf(r))} onChange={() => toggle(r)} aria-label={`Select ${r.name}`} /></td>
                      <td>
                        <strong>{r.name}</strong>
                        <div className="small muted">{r.description}</div>
                      </td>
                      <td className="small">{r.category}</td>
                      <td className="small muted">{r.paths.length ? r.paths.slice(0, 3).join(', ') : 'all files'}</td>
                    </tr>
                  );
                })}
              </Table>
            )}

            {tab === 'hooks' && (
              <Table head={['', 'Hook', 'Event', 'What it does']} rows={items.length} empty="No Devora library hooks match.">
                {items.map((i) => {
                  const h = i as HookItem;
                  return (
                    <tr key={keyOf(h)}>
                      <td><input type="checkbox" checked={picked.has(keyOf(h))} onChange={() => toggle(h)} aria-label={`Select ${h.name}`} /></td>
                      <td><strong>{h.name}</strong></td>
                      <td><Badge tone="muted">{h.event}</Badge></td>
                      <td className="small muted">{h.description}</td>
                    </tr>
                  );
                })}
              </Table>
            )}

            {tab === 'workflows' && (
              <Table head={['', 'Workflow', 'Phases', 'What it does']} rows={items.length} empty="No Devora library workflows match.">
                {items.map((i) => {
                  const w = i as WorkflowItem;
                  return (
                    <tr key={keyOf(w)}>
                      <td><input type="checkbox" checked={picked.has(keyOf(w))} onChange={() => toggle(w)} aria-label={`Select ${w.name}`} /></td>
                      <td><strong>{w.name}</strong><div className="small muted">{w.slug}</div></td>
                      <td className="small">{w.phases.join(' → ') || '—'}</td>
                      <td className="small muted">{w.description}</td>
                    </tr>
                  );
                })}
              </Table>
            )}

            {tab === 'contexts' && (
              <Table head={['', 'Context', 'Purpose']} rows={items.length} empty="No Devora library contexts match.">
                {items.map((i) => {
                  const c = i as ContextItem;
                  return (
                    <tr key={keyOf(c)}>
                      <td><input type="checkbox" checked={picked.has(keyOf(c))} onChange={() => toggle(c)} aria-label={`Select ${c.name}`} /></td>
                      <td><strong>{c.name}</strong><div className="small muted">{c.slug}</div></td>
                      <td className="small muted">{c.description}</td>
                    </tr>
                  );
                })}
              </Table>
            )}

            <p className="small muted" style={{ marginTop: 12 }}>
              Publishing converts library items into organization entries: agents become organization agents; skills, commands, rules, hooks, workflows and
              context packs become organization skills — commands arrive named <code>Devora /</code> (desktops also list every bundled command in their "/"
              menu out of the box), rules as <code>Devora Rule /</code>, hooks as <code>Devora Hook /</code> (checklist guidance), workflows as
              <code>Devora Workflow /</code> (phase plans) and context packs as <code>Devora Context /</code> (operating modes). Devora never executes hook
              or workflow scripts — they are advisory only. Published items use slugs starting with <code>ecc-</code>, so "Remove published" only touches
              library entries.
            </p>
          </Card>
        </>
      )}
    </Page>
  );
}

function filter(list: Item[], q: string): Item[] {
  if (!q) return list;
  return list.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || i.slug.includes(q));
}
