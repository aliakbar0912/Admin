// Bundles the admin site into dist/: index.html, app.js (+ source map), app.css. No runtime configuration is baked in:
// the API origin is supplied when the static server starts (see server.mjs).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'src', 'main.tsx')],
  outfile: path.join(dist, 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome120', 'firefox120', 'safari17'],
  jsx: 'automatic',
  sourcemap: true,
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'css' },
  logLevel: 'warning',
});
fs.copyFileSync(path.join(root, 'src', 'styles.css'), path.join(dist, 'app.css'));
fs.copyFileSync(path.join(root, 'src', 'index.html'), path.join(dist, 'index.html'));
console.log('built admin/dist');
