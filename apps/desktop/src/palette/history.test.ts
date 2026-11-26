// history.json keeps real open times, and is written on open rather than only at quit.

import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  flushPaletteHistoryFromApp,
  historyFromSession,
  loadPaletteHistory,
  parseHistoryFile,
  resetPaletteHistoryMirror,
  serializeHistoryFile,
  sessionFromHistory,
  trackDocumentOpen,
} from './history.ts';
import { adoptHistory, emptySession, recordOpen, setHydrationListener, setPaletteHydration, takePaletteHydration, togglePin, type PaletteSession } from './session.ts';
import { createMemoryShell } from '../shell/memory.ts';

afterEach(() => {
  resetPaletteHistoryMirror();
  setHydrationListener(undefined);
  takePaletteHydration();
  mock.timers.reset();
});

const HOUR = 3_600_000;

/** Let every pending promise step (the save awaits configPaths before it writes). */
async function drain(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

test('a restart keeps relative recency: order and `at` values survive a round trip', () => {
  const t0 = 1_700_000_000_000;
  let session = emptySession('/repo');
  session = recordOpen(session, '/repo/old.md', '/repo', t0);
  session = recordOpen(session, '/repo/new.md', '/repo', t0 + HOUR);
  const bytes = serializeHistoryFile(historyFromSession(session));
  const { envelope } = parseHistoryFile(bytes);
  assert.deepEqual(envelope.opens, [
    { path: '/repo/old.md', at: t0 },
    { path: '/repo/new.md', at: t0 + HOUR },
  ]);
  const restored = sessionFromHistory(envelope, '/repo');
  assert.deepEqual(restored.mru, ['/repo/new.md', '/repo/old.md']);
  assert.deepEqual(restored.readAt, { '/repo/old.md': t0, '/repo/new.md': t0 + HOUR });
  assert.deepEqual(historyFromSession(restored).opens, envelope.opens);
});

test('a path with no recorded time keeps the synthetic value', () => {
  const session = { ...recordOpen(emptySession('/r'), '/r/a.md', '/r', 5), readAt: {} };
  const [open] = historyFromSession(session).opens;
  assert.equal(open!.path, '/r/a.md');
  assert.ok(open!.at > 1_000_000_000_000);
});

test('trackDocumentOpen writes history.json once, 1 s after the last open', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const shell = createMemoryShell({});
  await loadPaletteHistory(shell as never, '/repo');
  const writes = () => shell.calls.filter((c) => c.method === 'writeFileAtomic');
  trackDocumentOpen('/repo/a.md', '/repo');
  mock.timers.tick(600);
  trackDocumentOpen('/repo/b.md', '/repo');
  mock.timers.tick(999);
  assert.equal(writes().length, 0, 'the second open restarts the debounce');
  mock.timers.tick(1);
  await drain();
  assert.equal(writes().length, 1);
  const [path, bytes] = writes()[0]!.args as [string, Uint8Array];
  assert.equal(path, '/data/history.json');
  const { envelope } = parseHistoryFile(bytes);
  assert.deepEqual(envelope.opens.map((o) => o.path), ['/repo/a.md', '/repo/b.md']);
});

test('the quit flush cancels a pending debounced write and has the last word', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const shell = createMemoryShell({});
  await loadPaletteHistory(shell as never, '/repo');
  trackDocumentOpen('/repo/a.md', '/repo');
  await flushPaletteHistoryFromApp(shell as never, undefined);
  const writes = () => shell.calls.filter((c) => c.method === 'writeFileAtomic');
  assert.equal(writes().length, 1);
  mock.timers.tick(5_000);
  await drain();
  assert.equal(writes().length, 1, 'no second write after the quit flush');
});

test('a debounced write already in flight finishes before the quit flush writes', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const shell = createMemoryShell({});
  const order: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const realWrite = shell.writeFileAtomic.bind(shell);
  let first = true;
  shell.writeFileAtomic = async (path: string, bytes: Uint8Array) => {
    if (first) {
      first = false;
      order.push('debounced:start');
      await gate;
      order.push('debounced:end');
    } else {
      order.push('flush');
    }
    return realWrite(path, bytes);
  };
  await loadPaletteHistory(shell as never, '/repo');
  trackDocumentOpen('/repo/a.md', '/repo');
  mock.timers.tick(1_000);
  await drain();
  assert.deepEqual(order, ['debounced:start']);
  const flushing = flushPaletteHistoryFromApp(shell as never, undefined);
  await drain();
  assert.deepEqual(order, ['debounced:start'], 'the flush waits for the write in flight');
  release();
  await flushing;
  assert.deepEqual(order, ['debounced:start', 'debounced:end', 'flush']);
});

test('a back/forward stamp on a path the history already knows reaches history.json', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const shell = createMemoryShell({});
  await loadPaletteHistory(shell as never, '/repo');
  trackDocumentOpen('/repo/a.md', '/repo');
  const known = recordOpen(emptySession('/repo'), '/repo/a.md', '/repo', Date.now() + 10 * HOUR);
  await flushPaletteHistoryFromApp(shell as never, known);
  const write = shell.calls.filter((c) => c.method === 'writeFileAtomic').at(-1)!;
  const { envelope } = parseHistoryFile(write.args[1] as Uint8Array);
  assert.ok(envelope.opens.some((o) => o.path === '/repo/a.md' && o.at > Date.now() + 9 * HOUR));
});

const stored = (opens: { path: string; at: number }[], pins: string[]) =>
  createMemoryShell({ '/data/history.json': serializeHistoryFile({ version: 1, opens, pins, recentRoots: ['/r'] }) });

test('a placeholder emptySession leaves the loaded history for the palette that mounts after it', async () => {
  await loadPaletteHistory(stored([{ path: '/r/a.md', at: 1 }], ['/r/a.md']) as never, '/');
  assert.deepEqual(emptySession('/').pinned, []);
  assert.deepEqual(takePaletteHydration()?.pinned, ['/r/a.md']);
  assert.equal(takePaletteHydration(), null);
});

test('history.json read after the palette mounted joins it, and its pins survive the quit flush', async () => {
  const t0 = 1_700_000_000_000;
  let live: PaletteSession = recordOpen(emptySession('/'), '/r/c.md', undefined, t0 + 2 * HOUR);
  live = togglePin(live, '/r/c.md');
  setHydrationListener((disk) => (live = adoptHistory(disk, live)));
  const shell = stored([{ path: '/r/a.md', at: t0 }, { path: '/r/b.md', at: t0 + HOUR }], ['/r/a.md']);
  trackDocumentOpen('/r/c.md', '/r');
  await loadPaletteHistory(shell as never, '/');
  assert.deepEqual(live.mru, ['/r/c.md', '/r/b.md', '/r/a.md'], 'the open tracked before the read is on top');
  await flushPaletteHistoryFromApp(shell as never, live);
  const write = shell.calls.filter((c) => c.method === 'writeFileAtomic').at(-1)!;
  const { envelope } = parseHistoryFile(write.args[1] as Uint8Array);
  assert.deepEqual(envelope.pins, ['/r/a.md', '/r/c.md']);
  assert.deepEqual(envelope.opens.map((o) => o.path), ['/r/a.md', '/r/b.md', '/r/c.md']);
});

test('a hydration with no palette mounted waits for the mount', () => {
  setPaletteHydration({ ...emptySession('/r'), pinned: ['/r/a.md'] });
  let heard: PaletteSession | null = null;
  setHydrationListener((s) => (heard = s));
  assert.equal(heard, null);
  assert.deepEqual(takePaletteHydration()?.pinned, ['/r/a.md']);
});

test('a history.json that is there but cannot be read is never written over this session', async () => {
  const kept = serializeHistoryFile({ version: 1, opens: [{ path: '/r/a.md', at: 1 }], pins: ['/r/a.md'], recentRoots: ['/r'] });
  const shell = createMemoryShell({ '/data/history.json': kept });
  shell.readFile = async () => {
    throw Object.assign(new Error('EACCES'), { code: 'permission' });
  };
  await loadPaletteHistory(shell as never, '/r');
  trackDocumentOpen('/r/b.md', '/r');
  await flushPaletteHistoryFromApp(shell as never, emptySession('/r'));
  assert.equal(shell.calls.filter((c) => c.method === 'writeFileAtomic').length, 0);
  assert.deepEqual(await shell.peekFile('/data/history.json'), kept);
});

test('paths kept with backslashes by an earlier build read as slashed paths: one file is one entry', () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      opens: [
        { path: 'C:\\n\\a.md', at: 1 },
        { path: 'C:/n/a.md', at: 2 },
      ],
      pins: ['C:\\n\\a.md', 'C:/n/a.md'],
      recentRoots: ['C:\\n', 'C:/n'],
    }),
  );
  const { envelope, quarantine } = parseHistoryFile(bytes);
  assert.equal(quarantine, false);
  assert.deepEqual(envelope.opens.map((o) => o.path), ['C:/n/a.md', 'C:/n/a.md']);
  assert.deepEqual(envelope.pins, ['C:/n/a.md']);
  assert.deepEqual(envelope.recentRoots, ['C:/n']);
  assert.deepEqual(sessionFromHistory(envelope, '/').mru, ['C:/n/a.md']);
});
