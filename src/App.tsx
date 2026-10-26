// Application shell: sign-in, navigation, and the password confirmation dialog for sensitive changes.
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, onReauthRequired, onUnauthorized, setCsrf } from './api.ts';
import { Button, Field, Modal, Notice } from './ui.tsx';
import { Overview } from './pages/Overview.tsx';
import { Providers } from './pages/Providers.tsx';
import { Models } from './pages/Models.tsx';
import { Devices } from './pages/Devices.tsx';
import { Memory } from './pages/Memory.tsx';
import { Brain } from './pages/Brain.tsx';
import { Usage } from './pages/Usage.tsx';
import { Settings } from './pages/Settings.tsx';
import { Updates } from './pages/Updates.tsx';
import { Users } from './pages/Users.tsx';
import { WebSearch } from './pages/WebSearch.tsx';
import { Skills } from './pages/Skills.tsx';
import { Ecc } from './pages/Ecc.tsx';
import { Website } from './pages/Website.tsx';
import { ApiKeys } from './pages/ApiKeys.tsx';
import { Agents } from './pages/Agents.tsx';
import { Announcements } from './pages/Announcements.tsx';
import { AuditLog } from './pages/AuditLog.tsx';
import { Desktop } from './pages/Desktop.tsx';
import { Icon } from './ui.tsx';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: 'home', group: 'Monitor' },
  { id: 'usage', label: 'Usage & logs', icon: 'chart', group: 'Monitor' },
  { id: 'brain', label: 'Brain', icon: 'brain', group: 'Monitor' },
  { id: 'announcements', label: 'Announcements', icon: 'bell', group: 'Monitor' },
  { id: 'website', label: 'Website', icon: 'globe', group: 'Website' },
  { id: 'providers', label: 'Providers', icon: 'plug', group: 'AI' },
  { id: 'models', label: 'Models', icon: 'cube', group: 'AI' },
  { id: 'search', label: 'Web search', icon: 'search', group: 'AI' },
  { id: 'skills', label: 'Skills', icon: 'spark', group: 'AI' },
  { id: 'ecc', label: 'Devora Library', icon: 'spark', group: 'AI' },
  { id: 'agents', label: 'Agents', icon: 'bot', group: 'AI' },
  { id: 'apikeys', label: 'API keys', icon: 'key', group: 'API' },
  { id: 'users', label: 'Users', icon: 'user', group: 'Desktop app' },
  { id: 'devices', label: 'Devices', icon: 'monitor', group: 'Desktop app' },
  { id: 'desktop', label: 'Desktop config', icon: 'screen', group: 'Desktop app' },
  { id: 'updates', label: 'Updates', icon: 'download', group: 'Desktop app' },
  { id: 'memory', label: 'Memory', icon: 'brain', group: 'Desktop app' },
  { id: 'settings', label: 'Settings', icon: 'sliders', group: 'Server' },
  { id: 'audit', label: 'Audit log', icon: 'shield', group: 'Server' },
] as const;
const GROUPS = ['Monitor', 'Website', 'AI', 'API', 'Desktop app', 'Server'] as const;
type Theme = 'system' | 'light' | 'dark';
function loadTheme(): Theme {
  try {
    const t = localStorage.getItem('devora-admin-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}
function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('devora-admin-theme', t);
  } catch {
    /* storage unavailable */
  }
}
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
  const [theme, setTheme] = useState<Theme>(loadTheme());
  useEffect(() => applyTheme(theme), [theme]);

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
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">D</span>
          <span>Devora admin</span>
        </div>
        <nav aria-label="Main">
          {GROUPS.map((g) => (
            <div key={g} className="nav-group">
              <div className="nav-group-label">{g}</div>
              {PAGES.filter((p) => p.group === g).map((p) => (
                <button key={p.id} className={`nav-item${page === p.id ? ' nav-active' : ''}`} aria-current={page === p.id ? 'page' : undefined} onClick={() => go(p.id)}>
                  <Icon name={p.icon} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="theme-switch" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? 'on' : ''} title={`${t[0].toUpperCase()}${t.slice(1)} theme`} onClick={() => setTheme(t)}>
                <Icon name={t === 'system' ? 'monitor' : t === 'light' ? 'sun' : 'moon'} />
              </button>
            ))}
          </div>
          <div className="owner-box">
            <span className="avatar" aria-hidden="true">{session.email.slice(0, 1).toUpperCase()}</span>
            <div className="owner-text">
              <div className="muted small">Signed in as</div>
              <div className="small owner">{session.email}</div>
            </div>
          </div>
          <Button variant="ghost" small onClick={() => signOut(() => setSession({ status: 'out' }))}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="content">
        {page === 'overview' && <Overview />}
        {page === 'providers' && <Providers />}
        {page === 'models' && <Models />}
        {page === 'search' && <WebSearch />}
        {page === 'skills' && <Skills />}
        {page === 'ecc' && <Ecc />}
        {page === 'agents' && <Agents />}
        {page === 'announcements' && <Announcements />}
        {page === 'apikeys' && <ApiKeys />}
        {page === 'website' && <Website />}
        {page === 'users' && <Users />}
        {page === 'devices' && <Devices />}
        {page === 'desktop' && <Desktop />}
        {page === 'memory' && <Memory />}
        {page === 'brain' && <Brain />}
        {page === 'usage' && <Usage />}
        {page === 'updates' && <Updates />}
        {page === 'settings' && <Settings />}
        {page === 'audit' && <AuditLog />}
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
        <span className="brand-mark lg" aria-hidden="true">D</span>
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
