// Command palette matching: exact names first, prefix and word prefixes next, then substrings, stable within a score.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchItems, PALETTE_LIMIT, type PaletteItem } from '../src/palette.ts';

const ITEMS: PaletteItem[] = [
  { id: 'page:overview', label: 'Overview', group: 'Overview', icon: 'home' },
  { id: 'page:usage', label: 'Usage & logs', group: 'Insights', icon: 'chart', keywords: 'requests latency tokens' },
  { id: 'page:providers', label: 'Providers', group: 'Catalogue', icon: 'plug' },
  { id: 'page:models', label: 'Models', group: 'Catalogue', icon: 'cube' },
  { id: 'page:system', label: 'System health', group: 'Server', icon: 'pulse', keywords: 'database redis uptime' },
  { id: 'page:settings', label: 'Settings', group: 'Server', icon: 'sliders' },
  { id: 'action:theme', label: 'Change theme (now: light)', group: 'Actions', icon: 'sun', keywords: 'dark appearance' },
];

const labels = (items: PaletteItem[]) => items.map((i) => i.label);

test('an empty query returns the first entries in their natural order', () => {
  assert.deepEqual(labels(matchItems(ITEMS, '')), ITEMS.slice(0, PALETTE_LIMIT).map((i) => i.label));
  assert.deepEqual(labels(matchItems(ITEMS, '   ')), ITEMS.map((i) => i.label));
});

test('an exact name wins over a prefix, a word prefix and a substring', () => {
  assert.equal(matchItems(ITEMS, 'models')[0].id, 'page:models');
  assert.equal(matchItems(ITEMS, 'model')[0].id, 'page:models');
  assert.equal(matchItems(ITEMS, 'health')[0].id, 'page:system');
});

test('keywords and group names are searchable, and case does not matter', () => {
  assert.deepEqual(labels(matchItems(ITEMS, 'REDIS')), ['System health']);
  assert.deepEqual(labels(matchItems(ITEMS, 'catalogue')), ['Providers', 'Models']);
  assert.deepEqual(labels(matchItems(ITEMS, 'dark')), ['Change theme (now: light)']);
});

test('ties keep the original order and the result is capped', () => {
  const many: PaletteItem[] = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, label: `Page ${i}`, group: 'Pages', icon: 'cube' }));
  const res = matchItems(many, 'page');
  assert.equal(res.length, PALETTE_LIMIT);
  assert.deepEqual(res.slice(0, 3).map((r) => r.id), ['p0', 'p1', 'p2']);
});

test('output is capped even when every item matches', () => {
  assert.equal(matchItems(ITEMS, 'e').length <= PALETTE_LIMIT, true);
});
