// The Devora website's data, run from the same place as everything else: publish and edit the
// pricing plans shown on the website's /pricing page, read the support-form inbox and browse the
// Paddle webhook audit ledger. Everything is stored in PocketBase (the same store that owns the
// Devora accounts); the website picks changes up the next time it renders the page.
import { useState, type FormEvent } from 'react';
import { api, ApiError, when } from '../api.ts';
import { Badge, Button, Field, Modal, Notice, Page, Table, useLoad } from '../ui.tsx';

interface Plan {
  id: string;
  planId: string;
  name: string;
  tagline: string;
  billingPeriod: 'month' | 'year';
  priceDisplay: string;
  currency: string;
  paddlePriceId: string;
  features: string[];
  highlighted: boolean;
  enabled: boolean;
  sortOrder: number;
  updated: string;
}
interface SupportMessage {
  id: string;
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
  status: string;
  created: string;
}
interface WebhookEvent {
  id: string;
  eventId: string;
  eventType: string;
  created: string;
  payloadBytes: number;
  payloadPreview: string;
}
type PricingData = { plans: Plan[]; limits: Record<string, number> };
type SupportData = { messages: SupportMessage[] };
type WebhookData = { events: WebhookEvent[] };

type Tab = 'pricing' | 'support' | 'webhooks';

export function Website() {
  const [tab, setTab] = useState<Tab>('pricing');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'pricing', label: 'Pricing plans' },
    { id: 'support', label: 'Support inbox' },
    { id: 'webhooks', label: 'Webhook log' },
  ];
  return (
    <Page
      title="Website"
      intro="Everything the public Devora website shows: its pricing plans, the support-form inbox and the billing webhook audit log. Published plans appear on the website's pricing page within seconds."
    >
      <div className="tabs" role="tablist" aria-label="Website sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'pricing' && <Pricing />}
      {tab === 'support' && <Support />}
      {tab === 'webhooks' && <Webhooks />}
    </Page>
  );
}

function Pricing() {
  const { data, error, reload } = useLoad<PricingData>(() => api('GET', '/admin/api/website/pricing'));
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const toggle = async (p: Plan) => {
    setMessage(null);
    try {
      await api('PATCH', `/admin/api/website/pricing/${p.id}`, { enabled: !p.enabled });
      setMessage({ kind: 'success', text: p.enabled ? `${p.name} is hidden from the website.` : `${p.name} is live on the pricing page.` });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not change the plan.' });
    }
  };

  const list = data?.plans ?? [];
  const live = list.filter((p) => p.enabled).length;
  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <div className="actions-row">
        <span className="muted small">{live} live · {list.length} total</span>
        <Button variant="primary" onClick={() => setEditing('new')}>New plan</Button>
      </div>
      <Table
        head={['Plan', 'Price', 'Billing', 'Status', 'Order', 'Updated', 'Actions']}
        rows={list.length}
        empty="No pricing plans yet. Add one (for example “Pro”, $10 / month) and enable it — it appears on the website's pricing page immediately."
      >
        {list.map((p) => (
          <tr key={p.id}>
            <td>
              <strong>{p.name}</strong>
              <div className="small muted">
                {p.planId}
                {p.highlighted ? ' · highlighted' : ''}
                {p.tagline ? ` — ${p.tagline.length > 80 ? `${p.tagline.slice(0, 80)}…` : p.tagline}` : ''}
              </div>
            </td>
            <td className="small">{p.priceDisplay || <span className="muted">—</span>}{p.currency ? ` ${p.currency}` : ''}</td>
            <td className="small">{p.billingPeriod === 'year' ? 'yearly' : 'monthly'}</td>
            <td>{p.enabled ? <Badge tone="ok">live</Badge> : <Badge tone="muted">hidden</Badge>}</td>
            <td className="small">{p.sortOrder}</td>
            <td className="small">{when(p.updated)}</td>
            <td className="actions">
              <Button small onClick={() => setEditing(p)}>Edit</Button>
              <Button small onClick={() => void toggle(p)}>{p.enabled ? 'Hide' : 'Publish'}</Button>
              <Button small variant="danger" onClick={() => setDeleting(p)}>Delete</Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && data ? (
        <PlanEditor
          plan={editing === 'new' ? null : editing}
          limits={data.limits}
          onClose={() => setEditing(null)}
          onDone={(name, created) => {
            setEditing(null);
            setMessage({ kind: 'success', text: created ? `${name} created. Enable it to publish it on the website.` : `${name} saved.` });
            reload();
          }}
        />
      ) : null}
      {deleting ? (
        <Modal
          title={`Delete “${deleting.name}”?`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const p = deleting;
                  setDeleting(null);
                  try {
                    await api('DELETE', `/admin/api/website/pricing/${p.id}`);
                    setMessage({ kind: 'success', text: `${p.name} deleted.` });
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
          <p>The plan disappears from the website's pricing page immediately. This cannot be undone.</p>
        </Modal>
      ) : null}
    </>
  );
}

function PlanEditor(props: { plan: Plan | null; limits: Record<string, number>; onClose: () => void; onDone: (name: string, created: boolean) => void }) {
  const p = props.plan;
  const L = props.limits;
  const [planId, setPlanId] = useState(p?.planId ?? '');
  const [name, setName] = useState(p?.name ?? '');
  const [tagline, setTagline] = useState(p?.tagline ?? '');
  const [billingPeriod, setBillingPeriod] = useState<'month' | 'year'>(p?.billingPeriod ?? 'month');
  const [priceDisplay, setPriceDisplay] = useState(p?.priceDisplay ?? '');
  const [currency, setCurrency] = useState(p?.currency ?? 'USD');
  const [paddlePriceId, setPaddlePriceId] = useState(p?.paddlePriceId ?? '');
  const [features, setFeatures] = useState((p?.features ?? []).join('\n'));
  const [highlighted, setHighlighted] = useState(p?.highlighted ?? false);
  const [enabled, setEnabled] = useState(p?.enabled ?? true);
  const [sortOrder, setSortOrder] = useState(String(p?.sortOrder ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const featureList = features.split('\n').map((f) => f.trim()).filter(Boolean);
  const problems = [
    !planId.trim() && 'Plan ID is required.',
    planId.trim() && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(planId.trim()) && 'Plan ID: lowercase letters, digits and dashes only (e.g. “pro-monthly”).',
    !name.trim() && 'Name is required.',
    featureList.length > (L.maxFeatures ?? 12) && `At most ${L.maxFeatures ?? 12} features.`,
    featureList.some((f) => f.length > (L.feature ?? 160)) && `Each feature: at most ${L.feature ?? 160} characters.`,
  ].filter(Boolean) as string[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError('');
    const payload = {
      planId: planId.trim(),
      name: name.trim(),
      tagline: tagline.trim(),
      billingPeriod,
      priceDisplay: priceDisplay.trim(),
      currency: currency.trim().toUpperCase(),
      paddlePriceId: paddlePriceId.trim(),
      features: featureList,
      highlighted,
      enabled,
      sortOrder: Number(sortOrder) || 0,
    };
    try {
      if (p) await api('PATCH', `/admin/api/website/pricing/${p.id}`, payload);
      else await api('POST', '/admin/api/website/pricing', payload);
      props.onDone(payload.name, !p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the plan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={p ? `Edit ${p.name}` : 'New pricing plan'} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Plan ID" hint="Unique, stable identifier, e.g. “pro-monthly”. The website groups monthly and yearly by name.">
            <input value={planId} onChange={(e) => setPlanId(e.target.value)} maxLength={L.planId ?? 64} required />
          </Field>
          <Field label="Name" hint={`Shown as the plan title, e.g. “Pro”. At most ${L.name ?? 120} characters.`}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={L.name ?? 120} required />
          </Field>
        </div>
        <Field label="Tagline (optional)" hint="One short line under the title, e.g. “For daily coding with the best models”.">
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={L.tagline ?? 200} />
        </Field>
        <div className="grid-3">
          <Field label="Billing" hint="Monthly or yearly.">
            <select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value as 'month' | 'year')}>
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </select>
          </Field>
          <Field label="Price display" hint={'What visitors see, e.g. “$10” or “Free”. Leave empty to show “Custom”.'}>
            <input value={priceDisplay} onChange={(e) => setPriceDisplay(e.target.value)} maxLength={L.priceDisplay ?? 32} />
          </Field>
          <Field label="Currency" hint="Three-letter code for the checkout, e.g. USD.">
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={L.currency ?? 8} />
          </Field>
        </div>
        <Field label="Features (one per line)" hint={`Up to ${L.maxFeatures ?? 12} short lines, e.g. “Unlimited projects”.`}>
          <textarea rows={5} value={features} onChange={(e) => setFeatures(e.target.value)} />
        </Field>
        <div className="grid-3">
          <Field label="Paddle price ID (optional)" hint="Only once billing is live; empty = no checkout button.">
            <input value={paddlePriceId} onChange={(e) => setPaddlePriceId(e.target.value)} maxLength={L.paddlePriceId ?? 128} />
          </Field>
          <Field label="Sort order" hint="Lower numbers appear first (0–10000).">
            <input type="number" min={0} max={L.maxSortOrder ?? 10000} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
          <Field label="Visibility">
            <span className="check-row">
              <label className="check">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Live on the website
              </label>
              <label className="check">
                <input type="checkbox" checked={highlighted} onChange={(e) => setHighlighted(e.target.checked)} /> Highlighted
              </label>
            </span>
          </Field>
        </div>
        {problems.length ? <Notice kind="info">{problems.join(' ')}</Notice> : null}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="form-actions">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || problems.length > 0}>{busy ? 'Saving…' : p ? 'Save' : 'Create plan'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Support() {
  const { data, error, reload } = useLoad<SupportData>(() => api('GET', '/admin/api/website/support-messages'));
  const [reading, setReading] = useState<SupportMessage | null>(null);
  const [deleting, setDeleting] = useState<SupportMessage | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const setStatus = async (m: SupportMessage, status: string) => {
    setMessage(null);
    try {
      await api('PATCH', `/admin/api/website/support-messages/${m.id}`, { status });
      setMessage({ kind: 'success', text: `Marked as ${status}.` });
      reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not update the message.' });
    }
  };

  const list = data?.messages ?? [];
  const open = list.filter((m) => m.status === 'new' || m.status === 'open').length;
  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind={message.kind}>{message.text}</Notice>}
      <p className="muted small">Messages submitted through the website's support form. {open} waiting for a reply. To answer, reply to the sender's email address directly.</p>
      <Table head={['From', 'Subject', 'Category', 'Status', 'Received', 'Actions']} rows={list.length} empty="No support messages yet. Messages from the website's support form land here.">
        {list.map((m) => (
          <tr key={m.id}>
            <td>
              <strong>{m.name || <span className="muted">—</span>}</strong>
              <div className="small muted">{m.email}</div>
            </td>
            <td className="small">{m.subject}</td>
            <td className="small">{m.category}</td>
            <td>
              {m.status === 'handled' ? <Badge tone="ok">handled</Badge> : m.status === 'open' ? <Badge tone="warn">open</Badge> : <Badge tone="bad">new</Badge>}
            </td>
            <td className="small">{when(m.created)}</td>
            <td className="actions">
              <Button small onClick={() => setReading(m)}>Read</Button>
              {m.status !== 'handled' ? <Button small onClick={() => void setStatus(m, 'handled')}>Mark handled</Button> : null}
              <Button small variant="danger" onClick={() => setDeleting(m)}>Delete</Button>
            </td>
          </tr>
        ))}
      </Table>
      {reading ? (
        <Modal title={reading.subject} onClose={() => setReading(null)}>
          <p className="small muted">
            {reading.name || 'Anonymous'} &lt;{reading.email}&gt; · {when(reading.created)} · {reading.category}
          </p>
          <p className="prewrap">{reading.message}</p>
        </Modal>
      ) : null}
      {deleting ? (
        <Modal
          title="Delete this message?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const m = deleting;
                  setDeleting(null);
                  try {
                    await api('DELETE', `/admin/api/website/support-messages/${m.id}`);
                    setMessage({ kind: 'success', text: 'Message deleted.' });
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
          <p>The message is removed from the inbox. This cannot be undone.</p>
        </Modal>
      ) : null}
    </>
  );
}

function Webhooks() {
  const { data, error } = useLoad<WebhookData>(() => api('GET', '/admin/api/website/webhook-events'));
  const events = data?.events ?? [];
  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      <p className="muted small">The newest 100 billing webhook deliveries, kept as an audit log. Events arrive once Paddle billing is configured on the website.</p>
      <Table head={['Event', 'Type', 'Received', 'Size']} rows={events.length} empty="No webhook events yet. Once Paddle is connected, every delivery is recorded here exactly once.">
        {events.map((e) => (
          <tr key={e.id}>
            <td className="small mono">{e.eventId}</td>
            <td className="small">{e.eventType}</td>
            <td className="small">{when(e.created)}</td>
            <td className="small">{(e.payloadBytes / 1024).toFixed(1)} KB</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
