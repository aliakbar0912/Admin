// The owner's audit log: who changed what in this admin site, when. Entries are recorded automatically for every
// sensitive write (settings, providers, models, devices, users, releases, agents, skills, API keys, announcements).
// The log is read-only here; it is kept for the same retention window as the request logs and pruned automatically.
import { useEffect, useState } from 'react';
import { api, ago, when } from '../api.ts';
import { Badge, Button, Field, Notice, Page, Table, useLoad } from '../ui.tsx';

interface AuditEntry {
  id: number;
  createdAt: string;
  actor: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
}

/** Groups the stable action labels for the filter dropdown, matching the audit.withAudit wrappers on the server. */
const ACTIONS = [
  '', 'settings.update', 'desktop_config.update', 'provider.create', 'provider.update', 'provider.delete', 'provider.set_key', 'provider.clear_key', 'provider.test', 'provider.discover',
  'model.create', 'model.update', 'model.set_default', 'model.delete', 'device.revoke', 'device.unblock', 'device.set_models', 'user.action',
  'release.create', 'release.update', 'release.complete', 'release.delete', 'search_provider.create', 'search_provider.update', 'search_provider.delete',
  'search_provider.set_key', 'search_provider.clear_key', 'search_provider.test', 'skill.create', 'skill.update', 'skill.delete',
  'api_key.create', 'api_key.update', 'api_key.delete', 'agent.create', 'agent.update', 'agent.delete', 'announcement.create', 'announcement.update', 'announcement.delete',
];

const SENSITIVE = new Set(['provider.set_key', 'provider.clear_key', 'search_provider.set_key', 'search_provider.clear_key', 'api_key.create', 'api_key.delete', 'device.revoke', 'user.action', 'settings.update']);

function targetLabel(entry: AuditEntry): string {
  const parts = entry.action.split('.');
  const what = parts[0].replace(/_/g, ' ');
  const verb = parts.slice(1).join(' ').replace(/_/g, ' ');
  return `${what} — ${verb}`;
}

/** Deep links such as #/audit?action=provider.test open the page with the filter already applied. */
function actionFromHash(): string {
  const q = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q).get('action') ?? '';
}

export function AuditLog() {
  const [action, setAction] = useState(actionFromHash);
  const [limit, setLimit] = useState(50);
  useEffect(() => {
    const sync = () => setAction(actionFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const { data, error, loading, reload } = useLoad<{ entries: AuditEntry[]; nextCursor: string | null }>(
    () => api('GET', `/admin/api/audit?limit=${Math.min(limit, 200)}${action ? `&action=${encodeURIComponent(action)}` : ''}`),
    [action, limit],
  );
  const [message, setMessage] = useState('');

  const entries = data?.entries ?? [];
  const nextCursor = data?.nextCursor ?? null;

  const loadMore = () => {
    if (!nextCursor) return;
    // Loading more appends: refetch with a bigger limit (the server returns the newest N; the cursor keeps the page stable).
    setLimit((l) => Math.min(l + 100, 200));
    setMessage('');
  };

  return (
    <Page
      title="Audit log"
      intro="Every sensitive change made in this admin site, newest first: who made it, what changed and on which target. Request bodies are never recorded, so key material and content stay out of the log. Entries are kept for the same retention window as the request logs."
      actions={<Button onClick={() => reload()}>Refresh</Button>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="info">{message}</Notice>}
      <div className="filters">
        <Field label="Action">
          <select value={action} onChange={(e) => { setAction(e.target.value); setLimit(50); }}>
            {ACTIONS.map((a) => (
              <option key={a || 'all'} value={a}>{a || 'All actions'}</option>
            ))}
          </select>
        </Field>
      </div>
      <Table
        head={['When', 'Actor', 'Action', 'Target', 'Detail']}
        rows={entries.length}
        empty={loading ? 'Loading…' : 'Nothing recorded yet. Changes you make in this admin site appear here.'}
      >
        {entries.map((e) => (
          <tr key={e.id}>
            <td className="small" title={when(e.createdAt)}>{ago(e.createdAt)}</td>
            <td className="small">{e.actor || '—'}</td>
            <td>
              {SENSITIVE.has(e.action) ? <Badge tone="warn">{e.action}</Badge> : <Badge>{e.action}</Badge>}
            </td>
            <td className="small mono">{targetLabel(e)}</td>
            <td className="small mono">{Object.keys(e.detail ?? {}).length ? JSON.stringify(e.detail) : '—'}</td>
          </tr>
        ))}
      </Table>
      {nextCursor && (
        <div className="form-actions">
          <Button onClick={loadMore}>Load more</Button>
        </div>
      )}
    </Page>
  );
}
