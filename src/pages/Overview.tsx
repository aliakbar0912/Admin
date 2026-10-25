import { ago, api, when } from '../api.ts';
import { Badge, Card, Page, Spinner, Stat, useLoad } from '../ui.tsx';

interface OverviewData {
  providersEnabled: number;
  providersTotal: number;
  modelsEnabled: number;
  devicesActive: number;
  requests24h: number;
  failed24h: number;
  p50Ms: number | null;
  p95Ms: number | null;
  apiKeysEnabled: number;
  orgAgentsEnabled: number;
  orgSkillsEnabled: number;
  orgAnnouncementsEnabled: number;
  providers: { name: string; enabled: boolean; lastTestOk: boolean | null; lastTestAt: string | null; lastTestMessage: string | null }[];
}

interface HealthData {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  api: { uptimeSeconds: number; environment: string };
  database: { ok: boolean; latencyMs: number | null; schemaVersion: number | null; pendingMigrations: number | null; reason: string | null };
  redis: { configured: boolean; ok: boolean | null; latencyMs: number | null; target: string | null; reason: string | null };
  providers: { enabled: number; untested: number; failing: number; stale: number; staleAfterHours: number } | null;
  activity: { activeRequests: number | null; rateLimitStore: string };
  configuration: { cookieSecure: boolean; trustProxy: boolean; adminOriginConfigured: boolean; publicApiOriginConfigured: boolean; secretKeyringConfigured: boolean; databaseTls: boolean };
}

const HEALTH_TONE: Record<HealthData['status'], 'ok' | 'bad' | undefined> = { ok: 'ok', degraded: undefined, down: 'bad' };

export function Overview() {
  const { data, error, loading, reload } = useLoad<OverviewData>(() => api('GET', '/admin/api/overview'));
  const health = useLoad<HealthData>(() => api('GET', '/admin/api/health'));
  const releases = useLoad<{ releases: { version: string; status: string; mandatory: boolean; publishedAt: string | null }[]; adoption: { version: string; devices: number }[] }>(() => api('GET', '/admin/api/releases'));
  const failures = useLoad<{ logs: { id: number; createdAt: string; deviceName: string | null; modelName: string; errorCode: string | null; httpStatus: number }[] }>(() => api('GET', '/admin/api/logs?status=error&limit=5'));
  const latest = releases.data?.releases.find((r) => r.status === 'published') ?? null;
  const total = releases.data?.adoption.reduce((n, a) => n + a.devices, 0) ?? 0;
  return (
    <Page title="Overview" intro="Live status of the central service. Figures cover the last 24 hours." actions={<button className="btn btn-secondary" onClick={() => { reload(); health.reload(); releases.reload(); failures.reload(); }}>Refresh</button>}>
      {loading && !data && <Spinner />}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {data && (
        <>
          <div className="stats">
            <Stat label="Requests (24 h)" value={data.requests24h} />
            <Stat label="Failed (24 h)" value={data.failed24h} hint={data.requests24h ? `${Math.round((data.failed24h / data.requests24h) * 100)}% of requests` : undefined} />
            <Stat label="Median latency" value={data.p50Ms === null ? '—' : `${data.p50Ms} ms`} />
            <Stat label="95th percentile" value={data.p95Ms === null ? '—' : `${data.p95Ms} ms`} />
            <Stat label="Active devices" value={data.devicesActive} />
            <Stat label="Enabled models" value={data.modelsEnabled} hint={`${data.providersEnabled} of ${data.providersTotal} providers enabled`} />
            <Stat label="API keys" value={data.apiKeysEnabled} hint={<a href="#/apikeys">manage keys</a>} />
            <Stat label="Org agents" value={data.orgAgentsEnabled} hint={<a href="#/agents">manage agents</a>} />
            <Stat label="Org skills" value={data.orgSkillsEnabled} hint={<a href="#/skills">manage skills</a>} />
            <Stat label="Live announcements" value={data.orgAnnouncementsEnabled} hint={<a href="#/announcements">manage announcements</a>} />
          </div>
          <div className="two-col">
            <Card title="Desktop app">
              <ul className="plain-list">
                <li>
                  <strong>Latest version</strong>{' '}
                  {latest ? (
                    <>
                      <Badge tone="ok">{latest.version}</Badge>
                      {latest.mandatory && <> <Badge tone="warn">required</Badge></>}
                      <span className="muted small"> · released {ago(latest.publishedAt)}</span>
                    </>
                  ) : (
                    <span className="muted small">no update published yet · <a href="#/updates">publish one</a></span>
                  )}
                </li>
                {total > 0 && (
                  <li>
                    <strong>On the latest version</strong>{' '}
                    <span className="small">
                      {latest ? `${releases.data!.adoption.find((a) => a.version === latest.version)?.devices ?? 0} of ${total} computers` : `${total} computers`}
                    </span>
                    <div className="bars compact">
                      {releases.data!.adoption.slice(0, 4).map((a) => (
                        <div key={a.version} className="bar-row">
                          <span className="bar-label mono">{a.version}</span>
                          <span className="bar"><span style={{ width: `${Math.max(3, (a.devices / total) * 100)}%` }} /></span>
                          <span className="bar-value">{a.devices}</span>
                        </div>
                      ))}
                    </div>
                  </li>
                )}
              </ul>
            </Card>
            <Card title="Recent failed requests">
              {failures.data && failures.data.logs.length === 0 ? (
                <p className="muted">No failed requests. </p>
              ) : (
                <ul className="plain-list">
                  {failures.data?.logs.map((l) => (
                    <li key={l.id} className="small">
                      <Badge tone="bad">{l.errorCode ?? `HTTP ${l.httpStatus}`}</Badge> <strong>{l.modelName}</strong>
                      <span className="muted"> · {l.deviceName ?? 'unknown computer'} · {ago(l.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="small"><a href="#/usage">All requests and logs</a></p>
            </Card>
          </div>
          <Card title="Service health">
            {health.error && <p className="notice notice-error" role="alert">{health.error}</p>}
            {health.data && (
              <ul className="plain-list">
                <li>
                  <strong>Overall</strong> <Badge tone={HEALTH_TONE[health.data.status]}>{health.data.status}</Badge>{' '}
                  <span className="muted small">checked {when(health.data.checkedAt)}</span>
                </li>
                <li>
                  <strong>Database</strong>{' '}
                  {health.data.database.ok ? <Badge tone="ok">connected</Badge> : <Badge tone="bad">{health.data.database.reason ?? 'unavailable'}</Badge>}
                  {health.data.database.latencyMs !== null && <span className="muted small"> · {health.data.database.latencyMs} ms</span>}
                  {health.data.database.schemaVersion !== null && <span className="muted small"> · schema v{health.data.database.schemaVersion}</span>}
                </li>
                <li>
                  <strong>Redis</strong>{' '}
                  {!health.data.redis.configured ? (
                    <span className="muted small">not configured · rate limits kept in the database, no cache</span>
                  ) : health.data.redis.ok ? (
                    <>
                      <Badge tone="ok">connected</Badge>
                      {health.data.redis.latencyMs !== null && <span className="muted small"> · {health.data.redis.latencyMs} ms</span>}
                      {health.data.redis.target && <span className="muted small"> · {health.data.redis.target}</span>}
                    </>
                  ) : (
                    <Badge tone="bad">{health.data.redis.reason ?? 'unavailable'}</Badge>
                  )}
                </li>
                <li>
                  <strong>API server</strong> <Badge tone="ok">running</Badge>{' '}
                  <span className="muted small">up {Math.floor(health.data.api.uptimeSeconds / 60)} min · {health.data.api.environment}</span>
                </li>
                <li>
                  <strong>Providers</strong>{' '}
                  {health.data.providers ? (
                    <span className="small">
                      {health.data.providers.enabled} enabled
                      {health.data.providers.failing > 0 && <> · <Badge tone="bad">{health.data.providers.failing} failing</Badge></>}
                      {health.data.providers.untested > 0 && <> · <Badge>{health.data.providers.untested} not tested</Badge></>}
                      {health.data.providers.stale > 0 && <> · <Badge>{health.data.providers.stale} test older than {health.data.providers.staleAfterHours / 24} days</Badge></>}
                    </span>
                  ) : (
                    <span className="muted small">unavailable while the database is down</span>
                  )}
                </li>
                <li>
                  <strong>Requests in progress</strong> <span className="small">{health.data.activity.activeRequests ?? '—'}</span>{' '}
                  <span className="muted small">rate limits stored in {health.data.activity.rateLimitStore}</span>
                </li>
                <li>
                  <strong>Configuration</strong>{' '}
                  <span className="muted small">
                    {[
                      health.data.configuration.secretKeyringConfigured ? 'encryption key set' : 'encryption key MISSING',
                      health.data.configuration.cookieSecure ? 'secure cookies' : 'insecure cookies',
                      health.data.configuration.databaseTls ? 'database TLS' : 'database without TLS',
                      health.data.configuration.adminOriginConfigured ? 'admin origin set' : 'admin origin not set',
                    ].join(' · ')}
                  </span>
                </li>
              </ul>
            )}
          </Card>
          {data.modelsEnabled === 0 && (
            <p className="notice notice-info">
              No model is enabled yet, so desktop users see an empty model list. Add a provider, test it, then enable its models.
            </p>
          )}
          <Card title="Providers">
            {data.providers.length === 0 ? (
              <p className="muted">No providers yet.</p>
            ) : (
              <ul className="plain-list">
                {data.providers.map((p) => (
                  <li key={p.name}>
                    <strong>{p.name}</strong>{' '}
                    {!p.enabled && <Badge>disabled</Badge>}{' '}
                    {p.lastTestOk === null ? <Badge>not tested</Badge> : p.lastTestOk ? <Badge tone="ok">reachable</Badge> : <Badge tone="bad">failing</Badge>}
                    {p.lastTestAt && <span className="muted small"> · tested {when(p.lastTestAt)}</span>}
                    {p.lastTestMessage && p.lastTestOk === false && <div className="small muted">{p.lastTestMessage}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
