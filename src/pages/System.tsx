// System health: the owner's operational view of the API process, database, cache, configuration and provider probes.
// Everything is read-only except "Test all providers", which calls the same audited endpoint as the Providers page.
import { useEffect, useRef, useState } from 'react';
import { ago, api, ApiError, when } from '../api.ts';
import { Badge, Button, Card, Notice, Page, Stat, Table, useLoad } from '../ui.tsx';
import type { Provider } from './Providers.tsx';

interface Health {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  api: { uptimeSeconds: number; environment: string };
  database: { ok: boolean; latencyMs: number | null; schemaVersion: number | null; pendingMigrations: number | null; reason: string | null };
  redis: { configured: boolean; ok: boolean | null; latencyMs: number | null; target: string | null; reason: string | null };
  providers: { enabled: number; untested: number; failing: number; stale: number; staleAfterHours: number } | null;
  activity: { activeRequests: number | null; rateLimitStore: string };
  configuration: {
    cookieSecure: boolean;
    trustProxy: boolean;
    adminOriginConfigured: boolean;
    publicApiOriginConfigured: boolean;
    secretKeyringConfigured: boolean;
    databaseTls: boolean;
    redisTls: boolean | null;
  };
}

interface ProbeResult {
  name: string;
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

const HEADLINE: Record<Health['status'], string> = {
  ok: 'All checks pass.',
  degraded: 'The service is working, with warnings below.',
  down: 'The service cannot serve AI requests right now.',
};

function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${seconds} s`;
}

function configChecks(h: Health): { label: string; ok: boolean; detail: string }[] {
  const c = h.configuration;
  return [
    {
      label: 'Encryption key',
      ok: c.secretKeyringConfigured,
      detail: c.secretKeyringConfigured ? 'Provider and search keys can be encrypted at rest.' : 'No DEVORA_SECRET_KEYS is set, so keys entered in this panel cannot be stored safely.',
    },
    {
      label: 'Secure cookies',
      ok: c.cookieSecure,
      detail: c.cookieSecure ? 'Owner sessions are sent only over HTTPS.' : 'COOKIE_SECURE is off. Set it on before serving the admin over a public address.',
    },
    {
      label: 'Admin origin',
      ok: c.adminOriginConfigured,
      detail: c.adminOriginConfigured ? 'Only the configured admin site may call the admin API.' : 'ADMIN_ORIGIN is not set, so admin API calls are not restricted to one origin.',
    },
    {
      label: 'Public API origin',
      ok: c.publicApiOriginConfigured,
      detail: c.publicApiOriginConfigured ? 'Desktop sign-in and device links point at this address.' : 'PUBLIC_API_ORIGIN is not set; desktop links fall back to the request address.',
    },
    {
      label: 'Database TLS',
      ok: c.databaseTls,
      detail: c.databaseTls ? 'The database connection is encrypted.' : 'The database connection is not encrypted (acceptable only on a private network).',
    },
    {
      label: 'Reverse proxy',
      ok: c.trustProxy,
      detail: c.trustProxy ? 'Client addresses come from the proxy headers.' : 'TRUST_PROXY is off; rate limits key on the proxy address, not the client.',
    },
  ];
}

export function System() {
  const health = useLoad<Health>(() => api('GET', '/admin/api/health'));
  const [auto, setAuto] = useState(true);
  const [testing, setTesting] = useState(false);
  const [probeError, setProbeError] = useState('');
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);

  // Poll while the tab is visible; the reload function is kept in a ref so the interval survives re-renders.
  const reload = useRef(health.reload);
  reload.current = health.reload;
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') reload.current();
    }, 15_000);
    return () => clearInterval(t);
  }, [auto]);

  /** Probes every enabled provider one at a time, exactly like the Test button on the Providers page. */
  const testAll = async () => {
    setTesting(true);
    setProbeError('');
    setProbes([]);
    const results: ProbeResult[] = [];
    try {
      const { providers } = await api<{ providers: Provider[] }>('GET', '/admin/api/providers');
      const enabled = providers.filter((p) => p.enabled);
      if (!enabled.length) setProbeError('No provider is enabled, so there is nothing to test.');
      for (const p of enabled) {
        try {
          const r = await api<{ ok: boolean; message: string; latencyMs: number }>('POST', `/admin/api/providers/${p.id}/test`);
          results.push({ name: p.name, ok: r.ok, message: r.message, latencyMs: r.latencyMs });
        } catch (e) {
          results.push({ name: p.name, ok: false, message: e instanceof ApiError ? e.message : 'the test could not be completed', latencyMs: null });
        }
        setProbes([...results]);
      }
      health.reload();
    } catch (e) {
      setProbeError(e instanceof ApiError ? e.message : 'The provider list could not be loaded.');
    } finally {
      setTesting(false);
    }
  };

  const h = health.data;
  const checks = h ? configChecks(h) : [];
  const warnings = checks.filter((c) => !c.ok).length;

  return (
    <Page
      title="System health"
      intro="Live state of the API server, database, cache and provider connections. Nothing here changes a setting; the only action is running provider tests, which is recorded in the audit log."
      actions={
        <>
          <label className="check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh
          </label>
          <Button onClick={() => health.reload()} disabled={health.loading}>Refresh</Button>
          <Button variant="primary" onClick={() => void testAll()} disabled={testing}>
            {testing ? 'Testing…' : 'Test all providers'}
          </Button>
        </>
      }
    >
      {health.error && <Notice kind="error">{health.error}</Notice>}
      {!h && health.loading && <p className="muted">Loading health…</p>}
      {h && (
        <>
          <div className={`health-hero health-${h.status}`} role="status">
            <span className={`pulse ${h.status === 'ok' ? 'pulse-online' : ''}`} aria-hidden="true" />
            <div>
              <strong>{HEADLINE[h.status]}</strong>
              <div className="muted small">
                Checked {when(h.checkedAt)} · {ago(h.checkedAt)}
                {warnings > 0 && <> · {warnings} configuration warning(s)</>}
              </div>
            </div>
            <Badge tone={h.status === 'ok' ? 'ok' : h.status === 'down' ? 'bad' : 'warn'}>{h.status}</Badge>
          </div>

          {h.database.pendingMigrations ? (
            <Notice kind="error">
              {h.database.pendingMigrations} database migration(s) are pending. The API answers 503 until they run: start the migrate job (or run
              <code className="mono"> npm run migrate </code>) before serving traffic.
            </Notice>
          ) : null}

          <div className="stats">
            <Stat label="Uptime" value={uptime(h.api.uptimeSeconds)} hint={`environment: ${h.api.environment}`} />
            <Stat label="Database" value={h.database.ok ? 'Connected' : 'Unavailable'} hint={h.database.latencyMs !== null ? `${h.database.latencyMs} ms round trip` : h.database.reason ?? 'no answer'} />
            <Stat label="Schema version" value={h.database.schemaVersion ?? '—'} hint={h.database.pendingMigrations ? `${h.database.pendingMigrations} pending` : 'up to date'} />
            <Stat
              label="Cache"
              value={!h.redis.configured ? 'Not configured' : h.redis.ok ? 'Connected' : 'Unavailable'}
              hint={h.redis.configured && h.redis.latencyMs !== null ? `${h.redis.latencyMs} ms` : h.redis.configured ? h.redis.reason ?? 'no answer' : 'limits use the database'}
            />
            <Stat label="Requests in progress" value={h.activity.activeRequests ?? '—'} hint={`leases stored in ${h.activity.rateLimitStore}`} />
            <Stat label="Provider tests" value={h.providers ? `${h.providers.enabled} enabled` : '—'} hint={h.providers ? `${h.providers.failing} failing · ${h.providers.untested} untested · ${h.providers.stale} older than ${Math.round(h.providers.staleAfterHours / 24)} days` : 'unavailable while the database is down'} />
          </div>

          <div className="two-col">
            <Card title="Database">
              <ul className="checklist">
                <li>
                  <Badge tone={h.database.ok ? 'ok' : 'bad'}>{h.database.ok ? 'pass' : 'fail'}</Badge>
                  <div>
                    <strong>Connection and schema</strong>
                    <div className="muted small">
                      {h.database.ok
                        ? `Schema version ${h.database.schemaVersion}, no pending migrations.`
                        : h.database.pendingMigrations
                          ? `${h.database.pendingMigrations} migration(s) pending; the API reports 503 until they run.`
                          : h.database.reason ?? 'The database did not answer.'}
                    </div>
                  </div>
                </li>
                <li>
                  <Badge tone={h.database.latencyMs !== null && h.database.latencyMs < 250 ? 'ok' : 'warn'}>latency</Badge>
                  <div>
                    <strong>{h.database.latencyMs ?? '—'} ms</strong>
                    <div className="muted small">Time for a round trip from the API process. Above 250 ms usually means a distant database.</div>
                  </div>
                </li>
              </ul>
            </Card>
            <Card title="Cache and rate limits">
              <ul className="checklist">
                <li>
                  <Badge tone={!h.redis.configured ? 'muted' : h.redis.ok ? 'ok' : 'bad'}>{!h.redis.configured ? 'optional' : h.redis.ok ? 'pass' : 'fail'}</Badge>
                  <div>
                    <strong>{!h.redis.configured ? 'Redis is not configured' : h.redis.ok ? `Connected in ${h.redis.latencyMs} ms` : 'Redis is unreachable'}</strong>
                    <div className="muted small">
                      {!h.redis.configured
                        ? 'Rate limits and the provider-health cache live in the database instead. Everything keeps working.'
                        : h.redis.ok
                          ? `Rate limits are stored in Redis${h.redis.target ? ` at ${h.redis.target}` : ''}${h.configuration.redisTls ? ' with TLS' : ''}.`
                          : `${h.redis.reason ?? 'no answer'} — rate limits cannot be enforced, so the API reports not-ready.`}
                    </div>
                  </div>
                </li>
                <li>
                  <Badge tone={h.activity.rateLimitStore === 'unavailable' ? 'bad' : 'ok'}>{h.activity.rateLimitStore}</Badge>
                  <div>
                    <strong>Rate-limit store in use</strong>
                    <div className="muted small">This is where per-device and per-key limits are counted right now.</div>
                  </div>
                </li>
              </ul>
            </Card>
          </div>

          <Card title={`Configuration (${checks.length - warnings} of ${checks.length} pass)`}>
            <ul className="checklist">
              {checks.map((c) => (
                <li key={c.label}>
                  <Badge tone={c.ok ? 'ok' : 'warn'}>{c.ok ? 'pass' : 'check'}</Badge>
                  <div>
                    <strong>{c.label}</strong>
                    <div className="muted small">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Provider connections">
            <p className="muted small">
              The health check never calls a provider by itself: it reports the last explicit test per provider. Use “Test all providers” to refresh
              every enabled provider now; each test is recorded in the audit log and may use a small amount of provider quota.
            </p>
            {h.providers ? (
              <>
                {(h.providers.failing > 0 || h.providers.untested > 0) && (
                  <Notice kind="info">
                    {h.providers.failing > 0 && <>{h.providers.failing} enabled provider(s) failed their last test. </>}
                    {h.providers.untested > 0 && <>{h.providers.untested} have never been tested. </>}
                    {h.providers.stale > 0 && <>{h.providers.stale} {h.providers.stale === 1 ? 'was' : 'were'} tested more than {Math.round(h.providers.staleAfterHours / 24)} days ago.</>}
                  </Notice>
                )}
                {probeError && <Notice kind="error">{probeError}</Notice>}
                {probes && probes.length > 0 && (
                  <Table head={['Provider', 'Result', 'Latency', 'Message']} rows={probes.length}>
                    {probes.map((p) => (
                      <tr key={p.name}>
                        <td><strong>{p.name}</strong></td>
                        <td>{p.ok ? <Badge tone="ok">reachable</Badge> : <Badge tone="bad">failed</Badge>}</td>
                        <td className="small">{p.latencyMs !== null ? `${p.latencyMs} ms` : '—'}</td>
                        <td className="small muted">{p.message}</td>
                      </tr>
                    ))}
                  </Table>
                )}
                <p className="small">
                  <a href="#/providers">Manage providers</a> · <a href="#/models">Models</a> · <a href="#/audit?action=provider.test">Audit entries for tests</a>
                </p>
              </>
            ) : (
              <p className="muted">Provider state is unavailable while the database is down.</p>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
