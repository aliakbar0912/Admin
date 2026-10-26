// ECC Library: browse the bundled ECC library (agents, commands, skills) and publish selected items to the
// organization, so every desktop receives them through the normal org sync (Skills and Agents pages).
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
type Item = AgentItem | CommandItem | SkillItem;

interface Catalog {
  version: string;
  counts: { agents: number; commands: number; skills: number };
  agents: AgentItem[];
  commands: CommandItem[];
  skills: SkillItem[];
}

type Tab = 'agents' | 'commands' | 'skills';

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
    const all: Item[] = [...data.agents, ...data.commands, ...data.skills];
    const q = query.trim().toLowerCase();
    if (tab === 'agents') return filter(all.filter((i) => i.kind === 'agent'), q);
    if (tab === 'commands') return filter(all.filter((i) => i.kind === 'command'), q);
    return filter(all.filter((i) => i.kind === 'skill'), q);
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
    try {
      const res = await api<{ published: { agents: number; skills: number } }>('POST', '/admin/api/ecc/publish', {
        ...(all ? { all: true } : { agents, skills }),
      });
      setMessage({
        kind: 'success',
        text: `Published ${res.published.agents} agents and ${res.published.skills} skills to the organization. Desktops receive them on their next sync (within about 5 minutes).`,
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
      setMessage({ kind: 'success', text: `Removed ${res.removed.agents} ECC agents and ${res.removed.skills} ECC skills from the organization.` });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Removing failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="ECC Library"
      intro={`The bundled ECC library (v${data?.version ?? '—'}) ships with Devora: specialist agent presets, prompt commands and method skills. Everything is read-only data; nothing in it runs on its own and it never widens desktop permissions. Publish items to make them organization skills and agents on every desktop.`}
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
      {loading && !data && <Notice kind="info">Loading the ECC library…</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}

      {data && (
        <>
          <div className="stats">
            <Stat label="ECC version" value={`v${data.version}`} />
            <Stat label="Agents" value={data.counts.agents} hint="specialist presets" />
            <Stat label="Commands" value={data.counts.commands} hint="prompt templates" />
            <Stat label="Skills" value={data.counts.skills} hint="method notes" />
          </div>

          <Card title="Browse">
            <div className="row" style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {(['agents', 'commands', 'skills'] as Tab[]).map((t) => (
                <Button key={t} small variant={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
                  {t[0].toUpperCase() + t.slice(1)} ({t === 'agents' ? data.counts.agents : t === 'commands' ? data.counts.commands : data.counts.skills})
                </Button>
              ))}
              <input
                type="search"
                placeholder="Search by name or description…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: 1, minWidth: 200 }}
                aria-label="Search the ECC library"
              />
            </div>

            {tab === 'agents' && (
              <Table head={['', 'Agent', 'Access', 'Tools', 'Model']} rows={items.length} empty="No ECC agents match.">
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
              <Table head={['', 'Command', 'Arguments']} rows={items.length} empty="No ECC commands match.">
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
              <Table head={['', 'Skill', 'Location']} rows={items.length} empty="No ECC skills match.">
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

            <p className="small muted" style={{ marginTop: 12 }}>
              Commands are bundled with the desktop app itself (users run them with <code>/ecc &lt;command&gt;</code>); publishing applies to agents and skills.
              Published items use slugs starting with <code>ecc-</code>, so "Remove published" only touches ECC entries.
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
