// Devora accounts (PocketBase users). Everything goes through the API server's owner-only routes; this site never talks
// to PocketBase and never sees a PocketBase credential.
import { useState, type FormEvent } from 'react';
import { api, ApiError, sensitive, when } from '../api.ts';
import { Badge, Button, Field, Modal, Notice, Page, Table, useLoad } from '../ui.tsx';

interface UserRow {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  createdAt: string;
  status: 'active' | 'blocked' | 'deleting' | 'deleted';
  lastLoginAt: string | null;
  signedInDevices: number;
  deletionError: string | null;
}
interface UserList {
  configured: boolean;
  users: UserRow[];
  total: number;
  page: number;
  perPage: number;
}
interface UserDetail {
  user: { id: string; email: string; name: string; verified: boolean; createdAt: string } | null;
  state: { status: string; first_seen_at: string; last_login_at: string | null; deletion_step: string | null; deletion_error: string | null } | null;
  identities: { id: string; provider: string; created: string }[];
  devices: { id: string; name: string; status: string; createdAt: string; lastSeenAt: string | null; appVersion: string | null; signedIn: boolean; signedOutReason: string | null }[];
}

const STATUS: Record<UserRow['status'], { tone: 'ok' | 'warn' | 'bad' | 'muted'; label: string }> = {
  active: { tone: 'ok', label: 'active' },
  blocked: { tone: 'bad', label: 'blocked' },
  deleting: { tone: 'warn', label: 'deleting' },
  deleted: { tone: 'muted', label: 'deleted' },
};

export function Users() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const list = useLoad<UserList>(() => api('GET', `/admin/api/users?page=${page}&search=${encodeURIComponent(query)}`), [page, query]);
  const [open, setOpen] = useState<UserRow | null>(null);
  const [message, setMessage] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQuery(search.trim());
  };

  if (list.data && !list.data.configured) {
    return (
      <Page title="Users" intro="People who signed in to the desktop app with a Devora account.">
        <Notice kind="info">
          Accounts are not set up on this server. Set POCKETBASE_URL, POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD on the API service (see
          docs/ACCOUNTS.md) and restart it. Until then every desktop works without an account, as before.
        </Notice>
      </Page>
    );
  }

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.perPage)) : 1;
  return (
    <Page title="Users" intro="People who signed in to the desktop app with a Devora account (email, Google or GitHub). Identities live in PocketBase; Devora keeps only the user id with each device.">
      {list.error && <Notice kind="error">{list.error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <form className="toolbar" onSubmit={submit}>
        <input type="search" placeholder="Search email, name or id" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
        <Button type="submit">Search</Button>
        {query && <Button onClick={() => { setSearch(''); setQuery(''); setPage(1); }}>Clear</Button>}
      </form>
      <Table head={['User', 'Email verified', 'Status', 'Signed-in devices', 'Joined', 'Last sign-in', '']} rows={list.data?.users.length ?? 0} empty={query ? 'No user matches.' : 'Nobody has created an account yet.'}>
        {list.data?.users.map((u) => (
          <tr key={u.id}>
            <td>
              <strong>{u.name || u.email}</strong>
              {u.name && <div className="small muted">{u.email}</div>}
              <div className="small muted mono">{u.id}</div>
            </td>
            <td>{u.verified ? <Badge tone="ok">verified</Badge> : <Badge tone="warn">not verified</Badge>}</td>
            <td>
              <Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge>
              {u.deletionError && <div className="small muted">{u.deletionError}</div>}
            </td>
            <td className="small">{u.signedInDevices}</td>
            <td className="small">{when(u.createdAt)}</td>
            <td className="small">{when(u.lastLoginAt)}</td>
            <td className="actions"><Button small onClick={() => setOpen(u)}>Manage</Button></td>
          </tr>
        ))}
      </Table>
      {pages > 1 && (
        <div className="toolbar">
          <Button small disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="small muted">Page {page} of {pages}</span>
          <Button small disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      {open && (
        <UserDialog
          row={open}
          onClose={() => setOpen(null)}
          onDone={(text) => {
            setMessage(text);
            setOpen(null);
            list.reload();
          }}
        />
      )}
    </Page>
  );
}

function UserDialog(props: { row: UserRow; onClose: () => void; onDone: (text: string) => void }) {
  const detail = useLoad<UserDetail>(() => api('GET', `/admin/api/users/${props.row.id}`));
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const label = props.row.name || props.row.email;

  const act = async (action: 'block' | 'unblock' | 'sign-out' | 'delete', done: string, body?: unknown) => {
    setError('');
    try {
      const run = () => api('POST', `/admin/api/users/${props.row.id}/${action}`, body);
      const r: any = action === 'sign-out' ? await run() : await sensitive(run);
      props.onDone(action === 'delete' && r?.status === 'pending' ? `${label}: access removed; the account is finished deleting automatically once PocketBase answers.` : done);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The action failed.');
    }
  };

  const d = detail.data;
  return (
    <Modal
      title={label}
      onClose={props.onClose}
      footer={<Button onClick={props.onClose}>Close</Button>}
    >
      {detail.error && <Notice kind="error">{detail.error}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {d && (
        <>
          <dl className="facts">
            <dt>Email</dt>
            <dd>{d.user?.email ?? <span className="muted">deleted</span>} {d.user && (d.user.verified ? <Badge tone="ok">verified</Badge> : <Badge tone="warn">not verified</Badge>)}</dd>
            <dt>Linked sign-ins</dt>
            <dd>{d.identities.length ? d.identities.map((i) => i.provider).join(', ') : <span className="muted">none (email and password only)</span>}</dd>
            <dt>User id</dt>
            <dd className="mono small">{props.row.id}</dd>
          </dl>
          <UserActivity userId={props.row.id} />
          <h3 className="section-title">Devices</h3>
          <Table head={['Name', 'Session', 'Version', 'Last seen']} rows={d.devices.length} empty="No device has signed in with this account.">
            {d.devices.map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td>
                <td>{x.status !== 'active' ? <Badge tone="bad">computer blocked</Badge> : x.signedIn ? <Badge tone="ok">signed in</Badge> : <Badge tone="muted">{(x.signedOutReason ?? 'signed out').replace(/_/g, ' ')}</Badge>}</td>
                <td className="small mono">{x.appVersion ?? '—'}</td>
                <td className="small">{when(x.lastSeenAt)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <div className="form-actions">
        {props.row.status === 'active' && <Button onClick={() => act('sign-out', `${label} was signed out on every device.`)}>Sign out everywhere</Button>}
        {props.row.status === 'active' && <Button variant="danger" onClick={() => act('block', `${label} is blocked and signed out everywhere.`)}>Block account</Button>}
        {props.row.status === 'blocked' && <Button onClick={() => act('unblock', `${label} can sign in again.`)}>Unblock account</Button>}
        {(props.row.status === 'active' || props.row.status === 'blocked' || props.row.status === 'deleting') && !deleting && (
          <Button variant="danger" onClick={() => setDeleting(true)}>{props.row.status === 'deleting' ? 'Retry deletion' : 'Delete account'}</Button>
        )}
      </div>
      {deleting && (
        <div className="danger-zone">
          <p>
            Deletes the PocketBase account and its Google/GitHub links, ends every session and removes the account's synced memory. Usage records (no prompt
            content) stay until log retention removes them. This cannot be undone.
          </p>
          <Field label={`Type "${props.row.email}" to confirm`}>
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
          <Button variant="danger" disabled={confirm.toLowerCase() !== props.row.email.toLowerCase()} onClick={() => act('delete', `${label} was deleted.`, { confirmEmail: confirm })}>
            Delete permanently
          </Button>
        </div>
      )}
    </Modal>
  );
}

interface Activity {
  days: number;
  totals: { requests: number; failed: number; prompt_tokens: number; completion_tokens: number; searches: number };
  byModel: { model: string; requests: number; failed: number; promptTokens: number; completionTokens: number; avgMs: number }[];
  recent: { at: string; model: string; provider: string; status: string; httpStatus: number; error: string | null; latencyMs: number; promptTokens: number | null; completionTokens: number | null; device: string | null }[];
  brain: { active: number; latest: { id: string; kind: string; scope: string; content: string; pinned: boolean; updatedAt: string }[] };
}

/** One account's requests (metadata only) and brain (agent memory), across all its devices. */
function UserActivity({ userId }: { userId: string }) {
  const a = useLoad<Activity>(() => api('GET', `/admin/api/users/${userId}/activity?days=30`), [userId]);
  const [tab, setTab] = useState<'requests' | 'brain'>('requests');
  if (a.error) return <Notice kind="error">{a.error}</Notice>;
  if (!a.data) return <p className="muted small">Loading activity…</p>;
  const d = a.data;
  const fmt = (n: number) => n.toLocaleString();
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="stat-label">Requests (30 days)</div><div className="stat-value">{fmt(d.totals.requests)}</div><div className="stat-hint">{d.totals.failed} failed</div></div>
        <div className="stat"><div className="stat-label">Tokens (30 days)</div><div className="stat-value">{fmt(d.totals.prompt_tokens + d.totals.completion_tokens)}</div><div className="stat-hint">{fmt(d.totals.prompt_tokens)} in · {fmt(d.totals.completion_tokens)} out</div></div>
        <div className="stat"><div className="stat-label">Web searches</div><div className="stat-value">{fmt(d.totals.searches)}</div></div>
        <div className="stat"><div className="stat-label">Brain</div><div className="stat-value">{fmt(d.brain.active)}</div><div className="stat-hint">memories</div></div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'requests'} className={`tab${tab === 'requests' ? ' on' : ''}`} onClick={() => setTab('requests')}>Requests</button>
        <button role="tab" aria-selected={tab === 'brain'} className={`tab${tab === 'brain' ? ' on' : ''}`} onClick={() => setTab('brain')}>Brain</button>
      </div>
      {tab === 'requests' ? (
        <>
          <Table head={['Model', 'Requests', 'Failed', 'Tokens in / out', 'Avg time']} rows={d.byModel.length} empty="No requests in the last 30 days.">
            {d.byModel.map((m) => (
              <tr key={m.model}>
                <td>{m.model}</td>
                <td className="small">{fmt(m.requests)}</td>
                <td className="small">{m.failed ? <Badge tone="bad">{m.failed}</Badge> : 0}</td>
                <td className="small">{fmt(m.promptTokens)} / {fmt(m.completionTokens)}</td>
                <td className="small">{m.avgMs} ms</td>
              </tr>
            ))}
          </Table>
          <h3 className="section-title">Recent requests</h3>
          <p className="small muted">Devora stores only request details (model, status, tokens, time), never the prompts or answers.</p>
          <Table head={['When', 'Model', 'Status', 'Tokens', 'Time', 'Device']} rows={d.recent.length} empty="No requests yet.">
            {d.recent.map((r, i) => (
              <tr key={i}>
                <td className="small">{when(r.at)}</td>
                <td className="small">{r.model}</td>
                <td>{r.status === 'ok' ? <Badge tone="ok">ok</Badge> : <Badge tone={r.status === 'cancelled' ? 'muted' : 'bad'}>{r.error ?? r.status}</Badge>}</td>
                <td className="small">{r.promptTokens ?? '—'} / {r.completionTokens ?? '—'}</td>
                <td className="small">{r.latencyMs} ms</td>
                <td className="small">{r.device ?? '—'}</td>
              </tr>
            ))}
          </Table>
        </>
      ) : (
        <>
          <p className="small muted">What the agent has learned for this account (synced from their desktops). Newest first; all of it is under Memory.</p>
          <Table head={['Kind', 'Memory', 'Updated']} rows={d.brain.latest.length} empty="No memories yet.">
            {d.brain.latest.map((m) => (
              <tr key={m.id}>
                <td><Badge tone="muted">{m.kind}</Badge>{m.pinned ? <> <Badge tone="ok">pinned</Badge></> : null}</td>
                <td className="small">{m.content}</td>
                <td className="small">{when(m.updatedAt)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
