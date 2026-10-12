// The tab list (W-06): pure, so a table. What the view makes of it is tabs.test.mjs, in WebKit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TAB_CAP, TabList, isTransient } from './tabs.ts';

const none = new Set<string>();
const shown = (...paths: string[]) => new Set(paths);

function listOf(...paths: string[]): TabList {
  const list = new TabList();
  for (const p of paths) list.add(p, shown(p));
  return list;
}

test('a document opened gets a tab to the right of the active one, and becomes the active one', () => {
  const list = listOf('/a.md', '/b.md', '/c.md');
  assert.deepEqual(list.snapshot(), { tabs: ['/a.md', '/b.md', '/c.md'], active: '/c.md' });
  list.activate('/a.md');
  list.add('/d.md', shown('/d.md'));
  assert.deepEqual(list.snapshot(), { tabs: ['/a.md', '/d.md', '/b.md', '/c.md'], active: '/d.md' });
});

test('a path already tabbed adds nothing: its tab is activated', () => {
  const list = listOf('/a.md', '/b.md');
  list.add('/a.md', shown('/a.md'));
  assert.deepEqual(list.snapshot(), { tabs: ['/a.md', '/b.md'], active: '/a.md' });
  assert.equal(list.activate('/nope.md'), false);
  assert.equal(list.snapshot().active, '/a.md', 'a path with no tab leaves the active tab alone');
});

test('closing picks the right neighbour, else the left, and skips what the other pane shows when it can', () => {
  const list = listOf('/a.md', '/b.md', '/c.md', '/d.md');
  assert.equal(list.neighbour('/b.md'), '/c.md');
  assert.equal(list.neighbour('/d.md'), '/c.md', 'the last tab has no right neighbour');
  assert.equal(list.neighbour('/b.md', shown('/c.md')), '/a.md', 'the right neighbour is in the other pane: the left one');
  assert.equal(list.neighbour('/a.md', shown('/b.md')), '/c.md', 'the nearest one that is free, even if it is not adjacent');
  const two = listOf('/a.md', '/b.md');
  assert.equal(two.neighbour('/a.md', shown('/b.md')), '/b.md', 'when every other tab is in use the nearest one is still offered');
  assert.equal(listOf('/a.md').neighbour('/a.md'), null, 'the last tab has none');
  assert.equal(list.neighbour('/zz.md'), null);
  list.close('/b.md');
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/c.md', '/d.md']);
  assert.equal(list.snapshot().active, '/d.md', 'closing another tab leaves the active one');
  list.close('/d.md');
  assert.equal(list.snapshot().active, null, 'closing the active tab leaves it to the next sync');
});

test('step goes round the row from the active tab; with one tab it goes nowhere', () => {
  const list = listOf('/a.md', '/b.md', '/c.md');
  assert.equal(list.step(1), '/a.md');
  assert.equal(list.step(-1), '/b.md');
  list.activate('/a.md');
  assert.equal(list.step(-1), '/c.md');
  assert.equal(listOf('/a.md').step(1), null);
});

test('a scratch or bundled document is a tab only while a pane shows it, and is never offered to open again', () => {
  const list = listOf('/a.md', 'untitled', '/b.md');
  list.add('marxy:about.md', shown('marxy:about.md', '/b.md'));
  assert.equal(isTransient('untitled:3') && isTransient('marxy:about.md') && !isTransient('/untitled.md'), true);
  list.prune(shown('/b.md', 'marxy:about.md'));
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/b.md', 'marxy:about.md']);
  list.prune(shown('/b.md'));
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/b.md']);
  assert.equal(list.snapshot().active, null, 'the active tab went with it');
  const withScratch = listOf('/a.md', 'untitled', '/c.md');
  assert.equal(withScratch.neighbour('/a.md'), '/c.md', 'a scratch tab cannot be the tab a close opens');
});

test('the cap drops the oldest tab no pane shows; the shown and the new ones stay', () => {
  const list = new TabList(4);
  for (const p of ['/1', '/2', '/3', '/4']) list.add(p, shown(p));
  list.add('/5', shown('/5', '/1'));
  assert.deepEqual(list.snapshot().tabs, ['/1', '/3', '/4', '/5'], '/2 was the oldest not shown (/1 is shown); /5 sits right of the active /4');
  assert.equal(list.snapshot().active, '/5');
  assert.equal(TAB_CAP, 24);
  const big = new TabList();
  for (let i = 0; i < 40; i++) big.add(`/f${i}.md`, none);
  assert.equal(big.snapshot().tabs.length, 24);
  assert.equal(big.snapshot().active, '/f39.md');
});

test('a rename keeps the tab\'s place; onto a path that has a tab it folds into that tab', () => {
  const list = listOf('/a.md', '/b.md', '/c.md');
  list.activate('/b.md');
  list.rename('/b.md', '/b2.md');
  assert.deepEqual(list.snapshot(), { tabs: ['/a.md', '/b2.md', '/c.md'], active: '/b2.md' });
  list.rename('/b2.md', '/c.md');
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/c.md'], 'two tabs for one path never exist');
  list.rename('/gone.md', '/x.md');
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/c.md']);
});

test('sync follows the panes: a document shown gets a tab, several at once keep the panes\' order, the focused one is active', () => {
  const list = new TabList();
  const left = {};
  const right = {};
  const a = {};
  const b = {};
  list.sync([{ key: left, path: '/a.md', store: a }], '/a.md');
  assert.deepEqual(list.snapshot(), { tabs: ['/a.md'], active: '/a.md' });
  list.sync([{ key: left, path: '/b.md', store: b }], '/b.md');
  assert.deepEqual(list.snapshot(), { tabs: ['/a.md', '/b.md'], active: '/b.md' });
  list.sync([{ key: left, path: '/b.md', store: b }], '/b.md');
  assert.deepEqual(list.snapshot(), { tabs: ['/a.md', '/b.md'], active: '/b.md' }, 'twice is once');
  // Two panes at once: both new, the left pane's first, right of the tab the reader was on (/b.md).
  list.activate('/a.md');
  list.sync([{ key: left, path: '/c.md', store: {} }, { key: right, path: '/d.md', store: {} }], '/d.md');
  assert.deepEqual(list.snapshot(), { tabs: ['/a.md', '/c.md', '/d.md', '/b.md'], active: '/d.md' });
  list.sync([{ key: left, path: '/c.md', store: {} }, { key: right, path: '/d.md', store: {} }], '/c.md');
  assert.equal(list.snapshot().active, '/c.md', 'focus moves the active tab');
  // A pane that shows nothing (the frontispiece) adds nothing and keeps the active tab.
  list.sync([{ key: left, path: null, store: null }], null);
  assert.equal(list.snapshot().tabs.length, 4);
});

test('sync: the same store under a new path is a Save As, which moves the tab; a different store is another document', () => {
  const list = new TabList();
  const pane = {};
  const store = {};
  list.sync([{ key: pane, path: '/a.md', store: {} }], '/a.md');
  list.sync([{ key: pane, path: '/b.md', store }], '/b.md');
  list.sync([{ key: pane, path: '/b2.md', store }], '/b2.md');
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/b2.md'], 'b became b2: one tab, not two');
  list.sync([{ key: pane, path: '/c.md', store: {} }], '/c.md');
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/b2.md', '/c.md'], 'a different document keeps the tab of the one it replaced');
  list.sync([{ key: pane, path: 'untitled', store: {} }], 'untitled');
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/b2.md', '/c.md', 'untitled']);
  const scratch = {};
  list.sync([{ key: pane, path: 'untitled:2', store: scratch }], 'untitled:2');
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/b2.md', '/c.md', 'untitled:2'], 'another scratch document replaces the first');
  list.sync([{ key: pane, path: '/d.md', store: scratch }], '/d.md');
  assert.deepEqual(list.snapshot().tabs, ['/a.md', '/b2.md', '/c.md', '/d.md'], 'a scratch document saved is the file\'s tab');
});
