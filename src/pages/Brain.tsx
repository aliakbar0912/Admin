// Brain: the desktops' agent at a glance. Live heartbeats (who is online, who is working, on what) and the memory
// ("brain") they mirror to the server: size, growth, what kind of knowledge it holds and what gets used most.
// Refreshes itself every few seconds while the tab is visible.
import { useEffect, useState } from 'react';
import { ago, api } from '../api.ts';
import { Badge, Card, Page, Spinner, Stat, useLoad } from '../ui.tsx';

interface BrainTask { title: string; mode: string; status: string; iterations: number; toolCalls: number; startedAt: number }
interface BrainDevice {
  id: string;
  name: string;
  appVersion: string | null;
  lastSeenAt: string | null;
  beatAt: string | null;
  online: boolean;
  working: boolean;
  tasks: BrainTask[];
  lastStep: { kind: string; name: string; status: string; at: number } | null;
  counters: { tasksStarted: number; tasksCompleted: number; tasksFailed: number; toolCalls: number; uptimeSeconds: number } | null;
  localMemory: { total: number; lesson: number; verified: number } | null;
  memory: { active: number; lessons: number; verified: number; lastUpdate: string | null };
}
interface BrainData {
  onlineSeconds: number;
  summary: { devices: number; online: number; working: number; activeTasks: number };
  memory: {
    active: number; verified: number; pinned: number; avgConfidence: number; hits: number; addedToday: number; forgottenToday: number;
    byKind: Record<string, number>; bySource: Record<string, number>;
  };
  growth: { day: string; added: number; tasks: number }[];
  devices: BrainDevice[];
  events: { id: string; kind: string; title: string; at: string; deviceName: string | null }[];
  topMemories: { id: string; kind: string; content: string; hits: number; confidence: number; verified: boolean; deviceName: string | null }[];
}

const REFRESH_MS = 5_000;
const KIND_LABEL: Record<string, string> = { fact: 'Facts', preference: 'Preferences', lesson: 'Lessons', decision: 'Decisions' };
const SOURCE_LABEL: Record<string, string> = { user: 'Told by the user', agent: 'Learned by the agent', system: 'Recorded from results' };
const EVENT: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  task_started: { label: 'started', tone: 'muted' },
  task_completed: { label: 'completed', tone: 'ok' },
  task_failed: { label: 'failed', tone: 'bad' },
  task_cancelled: { label: 'stopped', tone: 'warn' },
  online: { label: 'came online', tone: 'muted' },
  offline: { label: 'went offline', tone: 'muted' },
};

function since(ms: number): string {
  return ago(new Date(ms).toISOString());
}
function duration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

function Pulse(props: { device: BrainDevice }) {
  const d = props.device;
  const cls = d.working ? 'pulse pulse-working' : d.online ? 'pulse pulse-online' : 'pulse';
  return <span className={cls} role="img" aria-label={d.working ? 'working' : d.online ? 'online' : 'offline'} />;
}

function Bars(props: { values: Record<string, number>; labels: Record<string, string> }) {
  const total = Object.values(props.values).reduce((a, b) => a + b, 0);
  return (
    <div className="bars">
      {Object.entries(props.labels).map(([k, label]) => {
        const v = props.values[k] ?? 0;
        return (
          <div key={k} className="bar-row">
            <span className="bar-label">{label}</span>
            <span className="bar"><span style={{ width: total ? `${Math.max(v ? 3 : 0, (v / total) * 100)}%` : '0%' }} /></span>
            <span className="bar-value">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

function Growth(props: { rows: BrainData['growth'] }) {
  const max = Math.max(1, ...props.rows.map((r) => Math.max(r.added, r.tasks)));
  return (
    <>
      <div className="growth" role="img" aria-label="Memories added and tasks completed per day, last 14 days">
        {props.rows.map((r) => (
          <div key={r.day} className="growth-day" title={`${r.day}: ${r.added} memories added, ${r.tasks} tasks completed`}>
            <div className="growth-cols">
              <span className="growth-col growth-mem" style={{ height: `${(r.added / max) * 100}%` }} />
              <span className="growth-col growth-task" style={{ height: `${(r.tasks / max) * 100}%` }} />
            </div>
            <span className="growth-label">{r.day.slice(8)}</span>
          </div>
        ))}
      </div>
      <div className="legend small muted">
        <span><i className="dot growth-mem" /> memories added</span>
        <span><i className="dot growth-task" /> tasks completed</span>
      </div>
    </>
  );
}

function DeviceCard(props: { d: BrainDevice }) {
  const d = props.d;
  return (
    <div className={`brain-device${d.working ? ' brain-working' : ''}`}>
      <div className="brain-device-head">
        <Pulse device={d} />
        <strong>{d.name}</strong>
        {d.appVersion && <span className="muted small mono">{d.appVersion}</span>}
        <span className="spacer" />
        {d.working ? <Badge tone="ok">working</Badge> : d.online ? <Badge>idle</Badge> : <span className="muted small">last seen {ago(d.beatAt ?? d.lastSeenAt)}</span>}
      </div>
      {d.tasks.length > 0 && (
        <ul className="plain-list brain-tasks">
          {d.tasks.map((t, i) => (
            <li key={i}>
              <div className="brain-task-title">{t.title || 'Untitled task'}</div>
              <div className="small muted">
                {t.mode && <Badge>{t.mode}</Badge>} {t.status.replace(/_/g, ' ')} · {t.iterations} steps · {t.toolCalls} tool calls · for {duration(Math.max(1, Math.floor((Date.now() - t.startedAt) / 1000)))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="brain-meta small">
        {d.online && d.lastStep && (
          <span>
            Last step <span className="mono">{d.lastStep.name}</span> · {d.lastStep.status} · {since(d.lastStep.at)}
          </span>
        )}
        {d.online && d.counters && (
          <span className="muted">
            This session: {d.counters.tasksCompleted} done{d.counters.tasksFailed ? `, ${d.counters.tasksFailed} failed` : ''} · {d.counters.toolCalls} tool calls · open {duration(d.counters.uptimeSeconds)}
          </span>
        )}
        <span className="muted">
          Brain: {d.memory.active} memories ({d.memory.lessons} lessons, {d.memory.verified} verified){d.memory.lastUpdate ? ` · synced ${ago(d.memory.lastUpdate)}` : ''}
        </span>
      </div>
    </div>
  );
}

export function Brain() {
  const { data, error, loading, reload } = useLoad<BrainData>(() => api('GET', '/admin/api/brain'));
  const [live, setLive] = useState(true);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const online = data?.devices.filter((d) => d.online) ?? [];
  const offline = data?.devices.filter((d) => !d.online) ?? [];
  return (
    <Page
      title="Brain"
      intro="What the desktop agents are doing right now, and what their memory knows. Desktops send a heartbeat every 30 seconds while open."
      actions={
        <>
          <button className={`btn btn-secondary${live ? ' live-on' : ''}`} onClick={() => setLive((v) => !v)} aria-pressed={live}>
            {live ? '● Live' : 'Paused'}
          </button>
          <button className="btn btn-secondary" onClick={reload}>Refresh</button>
        </>
      }
    >
      {loading && !data && <Spinner />}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {data && (
        <>
          <div className="stats">
            <Stat label="Online now" value={data.summary.online} hint={`of ${data.summary.devices} computers`} />
            <Stat label="Working now" value={data.summary.working} hint={`${data.summary.activeTasks} tasks running`} />
            <Stat label="Memories" value={data.memory.active} hint={`+${data.memory.addedToday} today${data.memory.forgottenToday ? `, ${data.memory.forgottenToday} forgotten` : ''}`} />
            <Stat label="Verified" value={data.memory.verified} hint={data.memory.active ? `${Math.round((data.memory.verified / data.memory.active) * 100)}% of memories` : undefined} />
            <Stat label="Avg confidence" value={data.memory.avgConfidence ? `${Math.round(data.memory.avgConfidence * 100)}%` : '—'} />
            <Stat label="Recalls" value={data.memory.hits} hint="times memories were used" />
          </div>

          <Card title={`Live (${online.length} online)`}>
            {online.length === 0 ? (
              <p className="muted">No desktop is online right now. A computer shows here within 30 seconds of opening Devora.</p>
            ) : (
              <div className="brain-devices">{online.map((d) => <DeviceCard key={d.id} d={d} />)}</div>
            )}
            {offline.length > 0 && (
              <details className="brain-offline">
                <summary className="small muted">{offline.length} offline</summary>
                <div className="brain-devices">{offline.map((d) => <DeviceCard key={d.id} d={d} />)}</div>
              </details>
            )}
          </Card>

          <div className="two-col">
            <Card title="Brain growth (14 days)">
              <Growth rows={data.growth} />
            </Card>
            <Card title="What the brain knows">
              <Bars values={data.memory.byKind} labels={KIND_LABEL} />
              <div className="spacer-v" />
              <Bars values={data.memory.bySource} labels={SOURCE_LABEL} />
              <p className="small muted">{data.memory.pinned} pinned · <a href="#/memory">browse all memories</a></p>
            </Card>
          </div>

          <div className="two-col">
            <Card title="Activity feed">
              {data.events.length === 0 ? (
                <p className="muted">No activity yet.</p>
              ) : (
                <ul className="plain-list feed">
                  {data.events.map((e) => {
                    const ev = EVENT[e.kind] ?? { label: e.kind, tone: 'muted' as const };
                    return (
                      <li key={e.id}>
                        <span className="muted small feed-time">{ago(e.at)}</span>
                        <span>
                          <strong>{e.deviceName ?? 'Unknown computer'}</strong> <Badge tone={ev.tone}>{ev.label}</Badge> {e.title && <span className="feed-title">{e.title}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card title="Most used memories">
              {data.topMemories.length === 0 ? (
                <p className="muted">Nothing recalled yet.</p>
              ) : (
                <ul className="plain-list">
                  {data.topMemories.map((m) => (
                    <li key={m.id}>
                      <div>{m.content}</div>
                      <div className="small muted">
                        <Badge>{m.kind}</Badge> {m.hits} recalls · {Math.round(m.confidence * 100)}% confidence{m.verified ? ' · verified' : ''}{m.deviceName ? ` · ${m.deviceName}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </Page>
  );
}
