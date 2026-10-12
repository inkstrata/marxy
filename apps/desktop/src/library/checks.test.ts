// The library's checks (Q-06) over a fake shell: what is read (only the candidates, each once per version of the file),
// what is found, that the work yields to the page while it runs, and that the broken-path rule is the Links tab's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IndexEntry } from '@marxy/core';
import { resolveMention } from '@marxy/core/src/index-model/broken-paths.ts';
import { resolveMentioned, type StatFn } from '../workspace/links-tab.ts';
import { BuiltinCounts, LibraryChecks, type BrokenRun, type ChecksDeps } from './checks.ts';

const enc = new TextEncoder();
const NOW = Date.UTC(2026, 9, 12);
const D = 86_400_000;

const paragraph = (seed: string, n = 45): string => Array.from({ length: n }, (_, i) => `${seed}${(i * 7) % 97}w${i}`).join(' ');
const plan = (changed: string | null): string =>
  ['# Plan', ...Array.from({ length: 12 }, (_, i) => paragraph(i === 5 && changed !== null ? changed : `p${i}`))].join('\n\n');

const entry = (path: string, text: string, over: Partial<IndexEntry> = {}): IndexEntry => ({
  path,
  root: '/r',
  title: text.match(/^# (.*)$/m)?.[1] ?? path.split('/').pop()!,
  headings: [],
  mtimeMs: NOW - D,
  size: enc.encode(text).length,
  kind: path.endsWith('.ts') ? 'source' : 'markdown',
  readerKind: 'report',
  ...over,
});

/** A fake shell over `files`: folders are every parent of a file; reads are logged, as the memory shell logs them. */
function shell(files: Record<string, string>): ChecksDeps & { reads: string[]; stats: string[] } {
  const dirs = new Set<string>(['/']);
  for (const f of Object.keys(files)) for (let at = f.lastIndexOf('/'); at > 0; at = f.lastIndexOf('/', at - 1)) dirs.add(f.slice(0, at));
  const reads: string[] = [];
  const stats: string[] = [];
  return {
    reads,
    stats,
    read: async (path, max) => {
      reads.push(path);
      const text = files[path];
      if (text === undefined) throw new Error(`not found: ${path}`);
      return enc.encode(text).slice(0, max);
    },
    stat: async (path) => {
      stats.push(path);
      return path in files ? {} : dirs.has(path) ? { isDir: true } : null;
    },
    home: async () => null,
    rootOf: (e) => e.root,
  };
}

/** 5,000 files of distinct names and one size, and among them two families of near copies. */
function library(): { files: Record<string, string>; entries: IndexEntry[]; family: string[] } {
  const files: Record<string, string> = {};
  const entries: IndexEntry[] = [];
  for (let i = 0; i < 4994; i++) {
    const path = `/r/notes/note-${String(i).padStart(4, '0')}x.md`;
    const text = `# Note ${i}x\n\n${paragraph(`n${i}x`, 30)}\n`;
    files[path] = text;
    entries.push(entry(path, text, { mtimeMs: NOW - (i % 50) * D }));
  }
  const family = ['/r/plans/plan.md', '/r/plans/plan v2.md', '/r/plans/plan (copy).md', '/r/other/report.md', '/r/other/report-2.md', '/r/other/unrelated.md'];
  const texts = [plan(null), plan('changed'), plan(null), plan('r1'), plan('r2'), `# Unrelated\n\n${paragraph('zz', 400)}`];
  family.forEach((path, k) => {
    files[path] = texts[k]!;
    entries.push(entry(path, texts[k]!, { mtimeMs: NOW - (k + 1) * D }));
  });
  return { files, entries, family };
}

test('is:dup over 5,000 files reads only the candidate files, each once, and finds the groups newest first', async () => {
  const { files, entries } = library();
  const fake = shell(files);
  const checks = new LibraryChecks(fake);
  const run = (await checks.runDups(entries))!;
  // The candidates: the three plans (one name) and the two reports (one name, one title); "Plan" is the title of all five.
  assert.deepEqual([...fake.reads].sort(), ['/r/other/report-2.md', '/r/other/report.md', '/r/plans/plan (copy).md', '/r/plans/plan v2.md', '/r/plans/plan.md']);
  assert.equal(run.of, 5);
  const groups = checks.groups(run);
  assert.equal(groups.length, 1, 'one group at 85: the plans and the reports are all one plan with one paragraph changed');
  assert.deepEqual(groups[0]!.members.map((m) => m.entry.path), ['/r/plans/plan.md', '/r/plans/plan v2.md', '/r/plans/plan (copy).md', '/r/other/report.md', '/r/other/report-2.md']);
  const facts = checks.dupFacts(run);
  assert.equal(facts.get('/r/plans/plan v2.md')!.group, '/r/plans/plan.md');
  assert.equal(facts.get('/r/plans/plan.md')!.copies.find((c) => c.path === '/r/plans/plan (copy).md')!.similarity, 100);
  assert.equal(facts.has('/r/other/unrelated.md'), false);
  // Asked again over the same files: nothing is read again. A file that changed is read again, and only it.
  fake.reads.length = 0;
  await checks.runDups(entries);
  assert.deepEqual(fake.reads, []);
  const moved = entries.map((e) => (e.path === '/r/plans/plan v2.md' ? { ...e, mtimeMs: e.mtimeMs + 1 } : e));
  await checks.runDups(moved);
  assert.deepEqual(fake.reads, ['/r/plans/plan v2.md']);
});

test('the threshold is the session\'s: raising it splits a group without a read', async () => {
  const { files, entries } = library();
  const fake = shell(files);
  const checks = new LibraryChecks(fake);
  const run = (await checks.runDups(entries))!;
  let told = 0;
  checks.onThreshold(() => told++);
  fake.reads.length = 0;
  checks.threshold = 99;
  assert.equal(told, 1);
  assert.deepEqual(checks.groups(run).map((g) => g.members.map((m) => m.entry.path)), [['/r/plans/plan.md', '/r/plans/plan (copy).md']]);
  checks.threshold = 20;
  assert.equal(checks.threshold, 60, 'held to the slider\'s range');
  assert.deepEqual(fake.reads, []);
});

test('is:broken reads Markdown and text only, and names the missing paths; one under an unlisted folder is never broken', async () => {
  const files = {
    '/r/README.md': '# Readme\n\nSee `src/app.ts`, `src/gone.ts` and `nowhere/x.ts`.\n',
    '/r/notes.txt': 'notes name `docs/old.md` too\n',
    '/r/src/app.ts': 'const s = "`src/gone.ts`";\n',
    '/r/docs/guide.md': '# Guide\n\nNo paths here.\n',
  };
  const entries = Object.entries(files).map(([p, t]) => entry(p, t, p.endsWith('.txt') ? { kind: 'text' } : {}));
  const fake = shell(files);
  const checks = new LibraryChecks(fake);
  const run = (await checks.runBroken(entries))!;
  assert.deepEqual([...fake.reads].sort(), ['/r/README.md', '/r/docs/guide.md', '/r/notes.txt'], 'a source file is not read');
  assert.deepEqual([...run.broken], [['/r/README.md', ['src/gone.ts']], ['/r/notes.txt', ['docs/old.md']]]);
  assert.equal(run.checked, 3);
  assert.equal(checks.brokenFor(entries), run);
  // Nothing is written: the fake has no write, and the checks never asked for one.
  assert.equal('writeFileAtomic' in fake, false);
});

test('a run past its read budget stops and says how far it got', async () => {
  const { files, entries } = library();
  const checks = new LibraryChecks(shell(files));
  const run = (await checks.runBroken(entries, { budgetBytes: 4096 }))!;
  assert.equal(run.overBudget, true);
  assert.ok(run.checked < run.of && run.checked > 0, `${run.checked} of ${run.of}`);
});

test('a check gives the page a turn while it runs: a timer set as it starts fires before it ends', async () => {
  const { files, entries } = library();
  const checks = new LibraryChecks(shell(files));
  let firedAt = -1;
  let endedAt = -1;
  let step = 0;
  setTimeout(() => {
    firedAt = step++;
  }, 0);
  await checks.runBroken(entries);
  endedAt = step++;
  assert.ok(firedAt >= 0 && firedAt < endedAt, 'the timer ran inside the check');
  assert.ok(checks.longestSliceMs < 250, `the longest hold was ${checks.longestSliceMs.toFixed(1)} ms`);
});

test('an aborted run stops reading and answers nothing', async () => {
  const { files, entries } = library();
  const fake = shell(files);
  const checks = new LibraryChecks(fake);
  const controller = new AbortController();
  const pending = checks.runBroken(entries, { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, null);
  assert.ok(fake.reads.length < 50, `${fake.reads.length} reads after the abort`);
  assert.equal(checks.brokenFor(entries), null);
});

test('the sidebar\'s built-in counts: one run per set of entries, and the counts it found', async () => {
  const { files, entries } = library();
  files['/r/plans/plan.md'] += '\n\nSee `./gone.md` and `./plan.md`.\n';
  const list = entries.map((e) => (e.path === '/r/plans/plan.md' ? entry(e.path, files[e.path]!, { mtimeMs: e.mtimeMs }) : e));
  let changed = 0;
  const fake = shell(files);
  const counts = new BuiltinCounts(new LibraryChecks(fake), () => changed++);
  assert.equal(counts.get(), null);
  counts.request(list);
  counts.request(list);
  await counts.settled();
  assert.equal(counts.runs, 1, 'the same entries again start nothing');
  assert.deepEqual(counts.get(), { broken: { count: 1, partial: null }, dupGroups: { count: 1, partial: null } });
  assert.equal(changed, 1);
  assert.equal(new Set(fake.reads).size, fake.reads.length, 'no file is read twice for the two checks');
  counts.request(list);
  await counts.settled();
  assert.equal(counts.runs, 1);
});

test('the broken-path rule is the Links tab\'s: core and the tab agree on every case', async () => {
  const files = ['/repo/docs/a.md', '/repo/src/x.ts', '/Users/me/.config/x.toml'];
  const dirs = new Set(['/', '/repo', '/repo/docs', '/repo/src', '/Users', '/Users/me', '/Users/me/.config']);
  const stat: StatFn = async (p) => (files.includes(p) ? {} : dirs.has(p) && !p.endsWith('/linked') ? { isDir: true } : null);
  const cases: Array<[string, string, string | null]> = [];
  for (const path of ['./a.md', './gone.md', 'src/x.ts', '../src/x.ts', 'src/gone.ts', 'docs/a.md', 'docs/missing.md', 'linked/deep/x.md', '../../etc/passwd.txt', '~/.config/x.toml', '~/.config/y.toml']) {
    for (const doc of ['/repo/n.md', '/repo/docs/n.md']) for (const home of [null, '/Users/me']) cases.push([path, doc, home]);
  }
  for (const [path, doc, home] of cases) {
    assert.equal(await resolveMention(path, doc, '/repo', home, stat), await resolveMentioned(path, doc, '/repo', home, stat), `${path} from ${doc} (home ${home})`);
  }
});

test('a file read only in its first 256 KB says so: its run lists it as cut, and a near-copy score of it is marked partial', async () => {
  const head = `${plan(null)}\n\n${paragraph('common', 30_000)}`;
  const filler = (seed: string): string => `\n\n${paragraph(seed, 4_000)}`;
  // Two ~300 KB files the same for their first 256 KB and different after; the second names a missing path past the cut.
  const files = {
    '/r/big.md': head + filler('tailA'),
    '/r/big v2.md': head + filler('tailB') + '\n\nSee `./gone.md`.\n',
    '/r/small.md': '# Small\n\nSee `./gone.md`.\n',
  };
  const entries = Object.entries(files).map(([p, t]) => entry(p, t));
  assert.ok(entries[0]!.size > 300_000);
  const checks = new LibraryChecks(shell(files));
  const broken = (await checks.runBroken(entries))!;
  assert.deepEqual([...broken.cut].sort(), ['/r/big v2.md', '/r/big.md']);
  assert.deepEqual([...broken.broken.keys()], ['/r/small.md'], 'the path past the cut is not seen, and the run says the file was cut');
  const dups = (await checks.runDups(entries))!;
  assert.deepEqual([...dups.cut].sort(), ['/r/big v2.md', '/r/big.md']);
  const copy = checks.dupFacts(dups).get('/r/big.md')!.copies[0]!;
  assert.equal(copy.partial, true, 'a score of two cut files is of their first parts');
});

test('a run its budget stopped is continued: the next run reads only what is left, and runs converge on every file', async () => {
  const { files, entries } = library();
  const fake = shell(files);
  const checks = new LibraryChecks(fake);
  const runs: BrokenRun[] = [];
  for (let i = 0; i < 40; i++) {
    const run = (await checks.runBroken(entries, { budgetBytes: 64 * 1024 }))!;
    runs.push(run);
    if (!run.overBudget) break;
  }
  const last = runs.at(-1)!;
  assert.ok(runs.length > 2, `${runs.length} runs`);
  assert.equal(last.overBudget, false);
  assert.equal(last.checked, last.of);
  assert.equal(last.checkedPaths.size, last.of);
  assert.equal(new Set(fake.reads).size, fake.reads.length, 'no file was read twice across the runs');
  assert.ok(runs.every((r, k) => k === 0 || r.checked > runs[k - 1]!.checked), 'each run goes further');
});

test('the built-in counts carry a partial run as a floor, and go on until they are whole', async () => {
  const { files, entries } = library();
  files['/r/plans/plan.md'] += '\n\nSee `./gone.md` and `./plan.md`.\n';
  const list = entries.map((e) => (e.path === '/r/plans/plan.md' ? entry(e.path, files[e.path]!, { mtimeMs: e.mtimeMs }) : e));
  const seen: Array<ReturnType<BuiltinCounts['get']>> = [];
  const counts: BuiltinCounts = new BuiltinCounts(new LibraryChecks(shell(files)), () => seen.push(counts.get()), { budgetBytes: 256 * 1024 });
  counts.request(list);
  await counts.settled();
  assert.ok(seen.length >= 2, `${seen.length} landings`);
  assert.notEqual(seen[0]!.broken.partial, null, 'the first landing is partial');
  assert.ok(seen[0]!.broken.partial!.checked < seen[0]!.broken.partial!.of);
  assert.deepEqual(counts.get(), { broken: { count: 1, partial: null }, dupGroups: { count: 1, partial: null } }, 'whole in the end');
  assert.ok(counts.runs > 1);
});
