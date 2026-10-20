// Serves the admin website and its runtime configuration. Plain Node, no dependencies.
// All settings are read once, by loadAdminConfig(). The browser receives only the public API origin, through /config.js,
// so the same build works on any domain: changing ADMIN_API_ORIGIN needs a restart, never a rebuild.
// Environment:
//   ADMIN_API_ORIGIN  the API origin, for example https://api.YOUR_DOMAIN   (required)
//   PORT              default 8081
//   HOST              default 0.0.0.0
//   ADMIN_HSTS        "true" to send Strict-Transport-Security (default true in production)
//   NODE_ENV          "production" (set by the Dockerfile) turns on the production rules below
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

function apiOrigin(v, production) {
  if (!v) throw new Error('set ADMIN_API_ORIGIN, for example https://api.YOUR_DOMAIN');
  let u;
  try {
    u = new URL(v);
  } catch {
    throw new Error('ADMIN_API_ORIGIN must be a URL');
  }
  const loopback = LOOPBACK.includes(u.hostname);
  if (u.username || u.password) throw new Error('ADMIN_API_ORIGIN must not contain credentials');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new Error('ADMIN_API_ORIGIN must use https (http only for localhost)');
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('ADMIN_API_ORIGIN must be an origin without a path');
  if (production && loopback) throw new Error('ADMIN_API_ORIGIN must be the public https address of the API in production, not a local address');
  if (production && /YOUR_DOMAIN/i.test(u.hostname)) throw new Error('ADMIN_API_ORIGIN still contains the YOUR_DOMAIN placeholder');
  return u.origin;
}

function flag(v, fallback, name) {
  if (v === undefined || v === '') return fallback;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

/** Reads and validates every admin-site setting. Throws with a clear message on a missing or unsafe value. */
export function loadAdminConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT ?? 8081);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  return {
    production,
    apiOrigin: apiOrigin(env.ADMIN_API_ORIGIN, production),
    port,
    host: env.HOST || '0.0.0.0',
    hsts: flag(env.ADMIN_HSTS, production, 'ADMIN_HSTS'),
  };
}

export function createAdminServer({ apiOrigin: api, hsts = false }) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ${api}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ]);
  return http.createServer((req, res) => {
    const headers = {
      'content-security-policy': csp,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
      'cache-control': 'no-cache',
    };
    if (hsts) headers['strict-transport-security'] = 'max-age=31536000';
    const pathname = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, allow: 'GET, HEAD' });
      return res.end();
    }
    if (pathname === '/healthz') {
      res.writeHead(200, { ...headers, 'content-type': 'application/json' });
      return res.end('{"status":"ok"}');
    }
    if (pathname === '/config.js') {
      res.writeHead(200, { ...headers, 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(`window.__DEVORA_ADMIN_CONFIG__ = ${JSON.stringify({ apiOrigin: api })};\n`);
    }
    const entry = files.get(pathname);
    if (!entry) {
      res.writeHead(404, headers);
      return res.end();
    }
    const full = path.join(dist, entry[0]);
    if (!full.startsWith(dist + path.sep) || !fs.existsSync(full)) {
      res.writeHead(503, headers);
      return res.end('the admin site has not been built; run npm run build');
    }
    res.writeHead(200, { ...headers, 'content-type': entry[1] });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  });
}

// Start only when run directly (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let cfg;
  try {
    cfg = loadAdminConfig();
  } catch (e) {
    process.stderr.write(`configuration error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
  const server = createAdminServer({ apiOrigin: cfg.apiOrigin, hsts: cfg.hsts });
  server.listen(cfg.port, cfg.host, () => process.stdout.write(`admin site on ${cfg.host}:${cfg.port}, API ${cfg.apiOrigin}${cfg.production ? ' (production)' : ''}\n`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
