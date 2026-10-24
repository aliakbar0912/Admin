// The only way the admin site talks to the backend. Cookies carry the session; writes send the CSRF token from the session.
// The API origin comes from /config.js (served by the admin server from ADMIN_API_ORIGIN). Nothing else is trusted.
declare global {
  interface Window {
    __DEVORA_ADMIN_CONFIG__?: Record<string, unknown>;
  }
}

// Same-origin: the admin server proxies /admin/api/* to the API and adds the secret key there.
const origin = '';
let csrf = '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function setCsrf(token: string): void {
  csrf = token;
}

let unauthorized: (() => void) | null = null;
let reauthenticate: (() => Promise<boolean>) | null = null;
export function onUnauthorized(fn: () => void): void {
  unauthorized = fn;
}
export function onReauthRequired(fn: () => Promise<boolean>): void {
  reauthenticate = fn;
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrf;
  let res: Response;
  try {
    res = await fetch(origin + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'The API could not be reached. Check the API address and your connection.');
  }
  if (res.status === 204) return undefined as T;
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/admin/api/auth/login' && unauthorized) unauthorized();
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `request failed (${res.status})`);
  }
  return data as T;
}

/** Runs a sensitive change. When the server asks for a password confirmation, the owner is asked and the change is retried once. */
export async function sensitive<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'reauth_required' && reauthenticate && (await reauthenticate())) return fn();
    throw e;
  }
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Uploads one piece of a file as raw bytes (release installers). Same session, CSRF and error handling as api(). */
export async function uploadPiece<T = any>(path: string, piece: Blob): Promise<T> {
  let res: Response;
  try {
    res = await fetch(origin + path, { method: 'PUT', headers: { accept: 'application/json', 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, credentials: 'same-origin', body: piece });
  } catch {
    throw new ApiError(0, 'network', 'The upload was interrupted. Check your connection.');
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && unauthorized) unauthorized();
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `upload failed (${res.status})`);
  }
  return data as T;
}

export function bytes(n: number): string {
  if (!n) return '—';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
