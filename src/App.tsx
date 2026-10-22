// Application shell: sign-in, navigation, and the password confirmation dialog for sensitive changes.
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, onReauthRequired, onUnauthorized, setCsrf } from './api.ts';
import { Button, Field, Modal, Notice } from './ui.tsx';
import { Overview } from './pages/Overview.tsx';
import { Providers } from './pages/Providers.tsx';
import { Models } from './pages/Models.tsx';
import { Devices } from './pages/Devices.tsx';
import { Memory } from './pages/Memory.tsx';
import { Usage } from './pages/Usage.tsx';
import { Settings } from './pages/Settings.tsx';

const PAGES = [
  { id: 'overview', label: 'Overview' },
  { id: 'providers', label: 'Providers' },
  { id: 'models', label: 'Models' },
  { id: 'devices', label: 'Devices' },
  { id: 'memory', label: 'Memory' },
  { id: 'usage', label: 'Usage & logs' },
  { id: 'settings', label: 'Settings' },
] as const;
type PageId = (typeof PAGES)[number]['id'];

function currentPage(): PageId {
  const id = window.location.hash.replace(/^#\/?/, '') as PageId;
  return PAGES.some((p) => p.id === id) ? id : 'overview';
}

type Session = { status: 'loading' } | { status: 'out' } | { status: 'in'; email: string };

export function App() {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const [page, setPage] = useState<PageId>(currentPage());
  const [reauth, setReauth] = useState<{ resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    const onHash = () => setPage(currentPage());
    window.addEventListener('hashchange', onHash);
    onUnauthorized(() => {
      setCsrf('');
      setSession({ status: 'out' });
    });
    onReauthRequired(
      () =>
        new Promise<boolean>((resolve) => {
          setReauth({ resolve });
        }),
    );
    api('GET', '/admin/api/auth/session')
      .then((s: { csrfToken: string; owner: { email: string } }) => {
        setCsrf(s.csrfToken);
        setSession({ status: 'in', email: s.owner.email });
      })
      .catch(() => setSession({ status: 'out' }));
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (session.status === 'loading') return <div className="boot">Loading…</div>;
  if (session.status === 'out') return <SignIn onSignedIn={(email) => setSession({ status: 'in', email })} />;

  const go = (id: PageId) => {
    window.location.hash = `#/${id}`;
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Devora admin</div>
        <nav aria-label="Main">
          {PAGES.map((p) => (
            <button key={p.id} className={`nav-item${page === p.id ? ' nav-active' : ''}`} aria-current={page === p.id ? 'page' : undefined} onClick={() => go(p.id)}>
              {p.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="muted small">Signed in as</div>
          <div className="small owner">{session.email}</div>
          <Button variant="ghost" small onClick={() => signOut(() => setSession({ status: 'out' }))}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="content">
        {page === 'overview' && <Overview />}
        {page === 'providers' && <Providers />}
        {page === 'models' && <Models />}
        {page === 'devices' && <Devices />}
        {page === 'memory' && <Memory />}
        {page === 'usage' && <Usage />}
        {page === 'settings' && <Settings />}
      </main>
      {reauth && <ReauthDialog onDone={(ok) => { reauth.resolve(ok); setReauth(null); }} />}
    </div>
  );
}

async function signOut(done: () => void) {
  try {
    await api('POST', '/admin/api/auth/logout');
  } finally {
    setCsrf('');
    done();
  }
}

function SignIn(props: { onSignedIn: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res: { csrfToken: string; owner: { email: string } } = await api('POST', '/admin/api/auth/login', { email, password });
      setCsrf(res.csrfToken);
      setPassword('');
      props.onSignedIn(res.owner.email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit} aria-label="Sign in">
        <h1>Devora admin</h1>
        <p className="intro">Owner access only. Sign in with the owner email and password.</p>
        <Field label="Email">
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}

function ReauthDialog(props: { onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('POST', '/admin/api/auth/reauth', { password });
      setPassword('');
      props.onDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm.');
      setBusy(false);
    }
  };
  return (
    <Modal title="Confirm your password" onClose={() => props.onDone(false)}>
      <form onSubmit={submit} className="form">
        <p className="muted">This change is sensitive. Confirm your password to continue. The confirmation lasts five minutes.</p>
        <Field label="Password">
          <input type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={() => props.onDone(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Confirm
          </Button>
        </div>
      </form>
    </Modal>
  );
}
