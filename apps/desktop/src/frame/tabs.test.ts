// The window's one row of tabs: each document once, the panes views onto it with their own histories; a refused open
// leaves nothing; glances replace each other; scratch tabs go; per-pane rows merge in order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutName, fairShare, folderHints, graphemesOf } from './tabs.ts';
import { WindowTabs, mergeRows } from './window-tabs.ts';

/** The row, the tab the focused pane shows starred and one another pane shows marked with a plus. */
const row = (t: WindowTabs): string[] =>
  t.tabs.map((x) => `${t.current === x ? '*' : t.slotsShowing(x.path).length > 0 ? '+' : ''}${x.path}`);

test('an open that says nothing is a tab of its own, after the shown one; the same file again is its tab', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  t.landed(0, '/b.md');
  assert.deepEqual(row(t), ['/a.md', '*/b.md']);
  t.landed(0, '/a.md');
  assert.deepEqual(row(t), ['*/a.md', '/b.md']);
  t.landed(0, '/c.md');
  assert.deepEqual(row(t), ['/a.md', '*/c.md', '/b.md']);
});

test('a second pane is a view onto the same row: opening beside never duplicates a tab', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  t.landed(0, '/b.md');
  t.landed(1, '/a.md');
  assert.deepEqual(row(t), ['+/a.md', '*/b.md']);
  t.focus(1);
  assert.deepEqual(row(t), ['*/a.md', '+/b.md']);
  t.landed(1, '/c.md');
  assert.deepEqual(row(t), ['/a.md', '*/c.md', '+/b.md']);
});

test('each pane keeps its own back and forward', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  t.landed(0, '/b.md');
  t.landed(1, '/c.md');
  assert.equal(t.step(0, -1), '/a.md');
  assert.equal(t.canBack(1), false);
  t.landed(0, '/a.md', 'back');
  assert.ok(t.canForward(0));
  assert.equal(t.step(0, 1), '/b.md');
  assert.deepEqual(t.tabs.map((x) => x.path), ['/a.md', '/b.md', '/c.md'], 'a step back opens no tab');
});

test('a link followed here takes the tab\'s place; back and forward swap it back, and a new step cuts the forward ones', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  t.landed(0, '/b.md', 'here');
  t.landed(0, '/c.md', 'here');
  assert.deepEqual(row(t), ['*/c.md']);
  assert.equal(t.step(0, -1), '/b.md');
  t.landed(0, '/b.md', 'back');
  assert.deepEqual(row(t), ['*/b.md']);
  assert.ok(t.canBack(0) && t.canForward(0));
  t.landed(0, '/d.md', 'here');
  assert.equal(t.canForward(0), false);
  t.landed(0, '/b.md', 'back');
  t.landed(0, '/a.md', 'back');
  assert.deepEqual(row(t), ['*/a.md']);
});

test('pressing a tab by its id shows that tab', () => {
  const t = new WindowTabs();
  const a = t.landed(0, '/a.md');
  t.landed(0, '/b.md');
  assert.equal(t.landed(0, '/a.md', 'activate', a.id).id, a.id);
  assert.equal(t.current?.id, a.id);
});

test('a glance is replaced by the next glance; keeping it makes it a tab', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  t.landed(0, '/b.md', 'glance');
  t.landed(0, '/c.md', 'glance');
  assert.deepEqual(row(t), ['/a.md', '*/c.md']);
  t.keep(t.current!.id);
  t.landed(0, '/d.md', 'glance');
  assert.deepEqual(row(t), ['/a.md', '/c.md', '*/d.md']);
});

test('closing a tab hands its panes to its right neighbour, else its left', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  const b = t.landed(0, '/b.md');
  const c = t.landed(0, '/c.md');
  assert.equal(t.nextAfterClose(b.id), '/c.md');
  assert.equal(t.nextAfterClose(c.id), '/b.md');
  t.remove(b.id);
  assert.deepEqual(t.tabs.map((x) => x.path), ['/a.md', '/c.md']);
});

test('a scratch document is a tab only while a pane shows it', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  t.landed(0, 'untitled:2');
  t.landed(0, '/a.md');
  assert.deepEqual(row(t), ['*/a.md']);
});

test('a file that moved takes its tab and every history step with it; onto an open path, one tab is left', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  t.landed(0, '/b.md', 'here');
  t.renamed('/a.md', '/z.md');
  assert.equal(t.step(0, -1), '/z.md');
  const u = new WindowTabs();
  u.landed(0, '/b.md');
  u.landed(0, '/a.md');
  u.renamed('/a.md', '/b.md');
  assert.deepEqual(u.tabs.map((x) => x.path), ['/b.md']);
});

test('one more than the cap closes the oldest tab no pane shows, and says so once', () => {
  const t = new WindowTabs(2);
  t.landed(0, '/1');
  t.landed(1, '/2');
  t.landed(0, '/3');
  assert.deepEqual(t.tabs.map((x) => x.path).sort(), ['/2', '/3']);
  assert.deepEqual(t.takeClosedByCap(), ['/1']);
  assert.deepEqual(t.takeClosedByCap(), []);
});

test('Pairs: the two shown tabs remember each other, and a closed partner is let go', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  const b = t.landed(1, '/b.md');
  t.pairShown();
  assert.equal(t.byPath('/a.md')?.pair, '/b.md');
  assert.equal(t.byPath('/b.md')?.pair, '/a.md');
  t.remove(b.id);
  assert.equal(t.byPath('/a.md')?.pair, null);
});

test('the left pane closing gives slot 0 the right pane\'s history', () => {
  const t = new WindowTabs();
  t.landed(0, '/a.md');
  t.landed(1, '/b.md');
  t.landed(1, '/c.md');
  t.landed(0, '/c.md');
  t.paneClosed(0);
  assert.equal(t.shownIn(0), '/c.md');
  assert.equal(t.step(0, -1), '/b.md');
  assert.equal(t.shownIn(1), null);
});

test('migration: a layout of two columns opens as one row in column order; per-pane rows merge in order, once each', () => {
  const t = new WindowTabs();
  t.landed(0, '/left.md');
  t.landed(1, '/right.md');
  assert.deepEqual(row(t), ['*/left.md', '+/right.md']);
  assert.deepEqual(mergeRows([['/a.md', '/b.md'], ['/c.md', '/a.md']]), ['/a.md', '/b.md', '/c.md']);
});

test('the row remembers the last twenty tabs closed, newest first, where each was, and never a scratch one', () => {
  const t = new WindowTabs();
  for (const p of ['/a.md', '/b.md', '/c.md', 'untitled:3']) t.landed(0, p);
  t.landed(0, '/a.md');
  assert.equal(t.canReopen, false);
  t.remove(t.byPath('/b.md')!.id);
  t.remove(t.byPath('/c.md')!.id);
  assert.equal(t.canReopen, true);
  assert.deepEqual(t.takeClosed(), { path: '/c.md', index: 1 });
  t.landed(0, '/b.md');
  assert.equal(t.takeClosed(), null, 'one open again is let go');
  for (let i = 0; i < 25; i++) {
    t.landed(0, `/n${i}.md`);
    t.remove(t.byPath(`/n${i}.md`)!.id);
  }
  let n = 0;
  while (t.takeClosed()) n++;
  assert.equal(n, 20);
});

/** Every grapheme 7 px wide: a cut as it is drawn, `…` where the head is cut. */
const w = (t: string): number => graphemesOf(t).length * 7;
const drawn = (name: string, chars: number, others: readonly string[] = []): string => {
  const cut = cutName(name, chars * 7, w, others);
  if (!cut) return name;
  assert.equal(cut.head + cut.tail, name, 'head and tail join to the whole name');
  return `${graphemesOf(cut.head).slice(0, cut.shown).join('')}…${cut.tail}`;
};

test('a cut keeps the extension and whole words, and gives the room to the end that tells the name apart', () => {
  const cases: [name: string, chars: number, others: string[], seen: string][] = [
    ['notes.md', 8, [], 'notes.md'],
    ['build-2026-10-14.log', 14, [], 'build-2…14.log'],
    // A start shared with another open name: the head could only repeat it, so the tail takes the room.
    ['2026-10-13-deploy.txt', 18, ['2026-10-14.md'], '…10-13-deploy.txt'],
    ['2026-10-13-deploy.txt', 15, ['2026-10-14.md'], '…13-deploy.txt'],
    ['2026-10-01-quarterly-planning-review-draft-3.md', 24, ['2026-10-01-quarterly-planning-review-draft-4.md'], '2026…review-draft-3.md'],
    // An end shared beyond the extension: the head gets the room.
    ['auth-refactor-handoff.md', 14, ['release-0.5-handoff.md'], 'auth-refac….md'],
    ['release-0.5-handoff.md', 14, ['auth-refactor-handoff.md'], 'release-0….md'],
    // A word at the end only while the head keeps a word too.
    ['auth-refactor-handoff.md', 18, [], 'auth-re…handoff.md'],
    ['auth-refactor-handoff.md', 14, [], 'auth-refac….md'],
    ['a-very-long-name-without-extension', 14, [], 'a-very-long-n…'],
    ['averylongnamewithoutseparators.txt', 14, [], 'averylong….txt'],
    ['ملاحظات-الاجتماع-الأسبوعي-الطويلة.md', 14, [], 'ملاحظات-ال….md'],
    // A bidi control reorders what follows it: cut at the end only, nothing taken for an extension.
    ['invoice\u202Efdp.exe-and-more.txt', 10, [], 'invoice\u202Ef…'],
  ];
  for (const [name, chars, others, seen] of cases) assert.equal(drawn(name, chars, others), seen, `${name} in ${chars}`);
});

test('a run of drafts that differ only in their number keep tails that tell them apart', () => {
  const drafts = Array.from({ length: 12 }, (_, i) => `2026-10-01-quarterly-planning-review-draft-${i + 1}.md`);
  const seen = drafts.map((d) => drawn(d, 14, drafts));
  assert.equal(new Set(seen).size, drafts.length, JSON.stringify(seen));
  assert.equal(seen[0], '…draft-1.md');
  assert.equal(seen[11], '…draft-12.md');
});

test('below three characters of head the tail gives way, then the name is cut at its end', () => {
  assert.equal(drawn('2026-10-13-deploy.txt', 12, ['2026-10-14.md']), '…deploy.txt');
  assert.equal(drawn('ab-cdefghijklmnop.md', 3, []), 'ab…');
});

test('fair share: natural widths while they fit, else one width for every wider tab, never under the floor', () => {
  assert.equal(fairShare([50, 100], 500, 80), Infinity);
  assert.equal(fairShare([50, 100, 200, 300], 500, 80), 175);
  assert.equal(fairShare([200, 200, 200], 300, 120), 120);
  const naturals = [60, 90, 240, 310, 180];
  const w = fairShare(naturals, 600, 80);
  assert.ok(naturals.reduce((s, n) => s + Math.min(n, w), 0) <= 600);
});

test('same names: each gains the shortest run of folders no other with that name shares', () => {
  const hints = folderHints(['/p/docs/README.md', '/p/api/docs/README.md', '/x/a.md', '/docs/README.md', 'C:\\w\\plans\\a.md']);
  assert.deepEqual(Object.fromEntries(hints), { '/p/docs/README.md': 'p/docs', '/p/api/docs/README.md': 'api/docs', '/docs/README.md': 'docs', '/x/a.md': 'x', 'C:\\w\\plans\\a.md': 'plans' });
});
