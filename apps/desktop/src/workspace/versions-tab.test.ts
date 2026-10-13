// The Versions tab's words and its restore names (V-06), without a browser: what each reason a file gets no versions says, what
// a listing that is not a list says (honestly: a damaged record, a newer Marxy's, nothing yet), each row's words, the counts of
// *Changed since you read*, and `name (version 14.32).md` with its free-name rule. The panel is versions-tab.test.mjs (WebKit).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { hourMinute, MAX_VERSION_COPIES, restoreToCopy, versionCopyPath } from '../versions/restore.ts';
import { ABOUT_VERSIONS, failureWords, listingNote, notKeptWords, sinceCounts, sizeWords, VERSIONS_TAB, versionRowWords } from './versions-tab.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

test('the tab is registered as Versions', () => {
  assert.equal(VERSIONS_TAB.id, 'versions');
  assert.equal(VERSIONS_TAB.title, 'Versions');
});

test('why a file gets no versions, in words', () => {
  assert.match(notKeptWords({ kind: 'off' }), /Versions are off: config\.toml says versions = false/);
  assert.match(notKeptWords({ kind: 'large', limit: 2 * 1024 * 1024 }), /larger than 2\.0 MB, the large-file limit/);
  assert.match(notKeptWords({ kind: 'denied', rule: 'node_modules', builtIn: true }), /in a node_modules folder, which Marxy never reads into/);
  assert.match(notKeptWords({ kind: 'denied', rule: '**/drafts/**', builtIn: false }), /the \[deny\] rule \*\*\/drafts\/\*\* in collection\.toml covers it/);
  assert.match(notKeptWords({ kind: 'scratch' }), /not a file yet/);
  assert.match(notKeptWords({ kind: 'own' }), /Marxy's own files/);
});

test('a listing that is not a list says what it is, never nothing', () => {
  assert.equal(listingNote({ kind: 'ok', versions: [], saved: null }), null);
  assert.match(listingNote({ kind: 'none' })!, /No earlier versions are kept yet/);
  const damaged = listingNote({ kind: 'damaged', reason: 'it is not valid JSON' })!;
  assert.match(damaged, /could not be read: it is not valid JSON/);
  assert.match(damaged, /no new ones are kept; Clear versions of this file starts it again/);
  assert.match(listingNote({ kind: 'newer' })!, /A newer Marxy/);
  assert.match(listingNote({ kind: 'unreadable', error: new Error('permission denied') })!, /permission denied/);
  assert.match(failureWords({ path: '/r/x.md', reason: 'before save', error: new Error('No space left on device'), time: 0 }), /could not be kept: No space left on device\. The save went through and replaced those bytes/);
});

test('each row says when, why and how large, and what is wrong with its copy', () => {
  const now = new Date(2026, 9, 13, 16, 0).getTime();
  const base = { id: 3, slot: 1, size: 1300, reason: 'before save' as const, bytes: 'ok' as const };
  const today = versionRowWords({ ...base, time: new Date(2026, 9, 13, 14, 32).getTime() }, now);
  assert.equal(today.when, '14.32 today');
  assert.equal(today.what, 'before save · 1.3 KB');
  assert.equal(today.state, null);
  assert.match(today.label, /^Version kept 14\.32 today, before save, 1\.3 KB\. Opens what changed since$/);
  assert.equal(versionRowWords({ ...base, time: new Date(2026, 9, 12, 9, 5).getTime() }, now).when, '09.05 yesterday');
  assert.equal(versionRowWords({ ...base, time: new Date(2026, 9, 2, 9, 5).getTime() }, now).when, '09.05 on 2 Oct');
  const missing = versionRowWords({ ...base, bytes: 'missing', time: now }, now);
  assert.equal(missing.state, 'copy missing');
  assert.match(missing.label, /Its copy missing$/);
  assert.equal(versionRowWords({ ...base, bytes: 'changed', time: now }, now).state, 'copy changed outside Marxy');
  assert.deepEqual([sizeWords(1), sizeWords(312), sizeWords(4200), sizeWords(52_000), sizeWords(1_900_000)], ['1 byte', '312 bytes', '4.1 KB', '51 KB', '1.8 MB']);
});

test('Changed since you read counts the lines added and removed', () => {
  assert.deepEqual(sinceCounts(enc('a\nb\nc\n'), enc('a\nB\nc\nd\n')), { added: 2, removed: 1 });
  assert.deepEqual(sinceCounts(enc('same\n'), enc('same\n')), { added: 0, removed: 0 });
});

test('the note under the list states the limits and that nothing leaves the machine', () => {
  assert.match(ABOUT_VERSIONS, /20 per file, 30 days, 200 MB in all/);
  assert.match(ABOUT_VERSIONS, /Nothing leaves this machine/);
});

test('a restored copy is named name (version HH.MM).ext beside the file; a taken name moves on to (version HH.MM 2)', async () => {
  const at = new Date(2026, 9, 13, 14, 32).getTime();
  assert.equal(hourMinute(at), '14.32');
  assert.equal(versionCopyPath('/r/x.md', at, 1), '/r/x (version 14.32).md');
  assert.equal(versionCopyPath('/r/x.md', at, 2), '/r/x (version 14.32 2).md');
  assert.equal(versionCopyPath('/r/Makefile', at, 1), '/r/Makefile (version 14.32)');
  assert.equal(versionCopyPath('/r/.env', at, 1), '/r/.env (version 14.32)');
  assert.equal(MAX_VERSION_COPIES, 999);
  // Over a folder of one taken name: the second is written, the taken one and the original are never written.
  const files = new Map<string, Uint8Array>([['/r/x.md', enc('now\n')], ['/r/x (version 14.32).md', enc('someone else\'s\n')]]);
  const writes: string[] = [];
  const notFound = (p: string) => Object.assign(new Error(`not found: ${p}`), { code: 'not-found' });
  const io = {
    stat: async (p: string) => (files.has(p) ? { path: p } : p === '/r' ? { path: p, isDir: true } : null),
    realPath: async (p: string) => {
      if (p === '/r' || files.has(p)) return p;
      throw notFound(p);
    },
    readHead: async (p: string) => {
      const b = files.get(p);
      if (!b) throw notFound(p);
      return b.slice(0, 0);
    },
    writeFileAtomic: async (p: string, b: Uint8Array) => {
      writes.push(p);
      files.set(p, b);
    },
  };
  const out = await restoreToCopy(io, '/r/x.md', enc('then\n'), at);
  assert.deepEqual(out, { result: 'written', path: '/r/x (version 14.32 2).md', n: 2 });
  assert.deepEqual(writes, ['/r/x (version 14.32 2).md']);
  assert.equal(new TextDecoder().decode(files.get('/r/x.md')), 'now\n');
  assert.equal(new TextDecoder().decode(files.get('/r/x (version 14.32).md')), 'someone else\'s\n');
});

test('a restore whose write fails reports it, writes no other path and leaves the original as it was', async () => {
  const at = new Date(2026, 9, 13, 14, 32).getTime();
  const files = new Map<string, Uint8Array>([['/r/x.md', enc('now\n')]]);
  const writes: string[] = [];
  const notFound = (p: string) => Object.assign(new Error(`not found: ${p}`), { code: 'not-found' });
  const io = {
    stat: async (p: string) => (files.has(p) ? { path: p } : p === '/r' ? { path: p, isDir: true } : null),
    realPath: async (p: string) => {
      if (p === '/r' || files.has(p)) return p;
      throw notFound(p);
    },
    readHead: async (p: string) => {
      if (!files.has(p)) throw notFound(p);
      return new Uint8Array(0);
    },
    writeFileAtomic: async (p: string) => {
      writes.push(p);
      throw Object.assign(new Error('No space left on device'), { code: 'io' });
    },
  };
  const out = await restoreToCopy(io, '/r/x.md', enc('then\n'), at);
  assert.equal(out.result, 'failed');
  assert.deepEqual(writes, ['/r/x (version 14.32).md'], 'one attempt, at the copy\'s name, never the original');
  assert.equal(new TextDecoder().decode(files.get('/r/x.md')), 'now\n');
  assert.deepEqual([...files.keys()], ['/r/x.md']);
});
