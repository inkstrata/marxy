// collection.toml into the index (C-10), over the memory shell: the file, its notice, `~`, file order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndexService } from '../index/service.ts';
import { createIndexFeed } from '../palette/index-feed.ts';
import { paletteResults } from '../palette/search.ts';
import { emptySession } from '../palette/session.ts';
import { createMemoryShell } from '../shell/memory.ts';
import { collectionFile, loadCollection, startCollection } from './load.ts';

const enc = (s: string) => new TextEncoder().encode(s);

/** The memory shell's config is `/config`, so collection.toml is `/collection.toml` and home is `/`. */
const files = (collection?: string): Record<string, Uint8Array> => ({
  '/c/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/c/README.md': enc('# Home\n'),
  '/c/notes.md': enc('# Notes in c\n'),
  '/a/notes.md': enc('# Notes in a\n'),
  '/b/notes.md': enc('# Notes in b\n'),
  ...(collection === undefined ? {} : { '/collection.toml': enc(collection) }),
});

function harness(collection: string | undefined, recent: readonly string[] = []) {
  const shell = createMemoryShell(files(collection));
  const notices: string[] = [];
  const notify = (n: { text: string }) => notices.push(n.text);
  const index = createIndexService(shell);
  const session = { ...emptySession('/c'), recentRoots: [...recent] };
  const feed = createIndexFeed({
    currentRoot: () => session.currentRoot,
    recentRoots: () => session.recentRoots,
    readAt: () => session.readAt,
  });
  index.subscribe((entries) => feed.setEntries(entries));
  const search = (q: string) =>
    paletteResults(q, feed.entries(), session, { prepared: feed.prepared(), rootRank: feed.rootRank() }).map(
      (hit) => hit.entry.path,
    );
  const start = async () => {
    await index.ensureFor('/c/README.md');
    return startCollection({
      shell,
      index,
      feed,
      currentPath: () => '/c/README.md',
      recentRoots: () => session.recentRoots,
      notify,
    });
  };
  return { shell, index, feed, notices, notify, search, start };
}

test('collection.toml sits beside config.toml', async () => {
  const shell = createMemoryShell({});
  assert.equal(await collectionFile(shell), '/collection.toml');
  const mac = { ...shell, configPaths: async () => ({ config: '/Users/r/Library/Application Support/marxy/config.toml', data: '/d' }) };
  assert.equal(await collectionFile(mac), '/Users/r/Library/Application Support/marxy/collection.toml');
});

test('no collection.toml is an empty collection and no notice', async () => {
  const { shell, notify, notices } = harness(undefined);
  const { collection, warnings } = await loadCollection(shell, { notify });
  assert.deepEqual(collection, { roots: [], denyGlobs: [], queries: [] });
  assert.deepEqual(warnings, []);
  assert.deepEqual(notices, []);
});

test('a malformed collection.toml costs one notice, and the current-root search still works', async () => {
  const h = harness('[[root]\npath = "/a"\n');
  const collection = await h.start();
  await collection.loaded;
  assert.equal(h.notices.length, 1, `notices: ${JSON.stringify(h.notices)}`);
  assert.match(h.notices[0]!, /collection\.toml/);
  assert.deepEqual(h.index.roots(), ['/c'], 'no extra folders');
  assert.deepEqual(h.search('notes'), ['/c/notes.md']);
  const marks = h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'collection_loaded');
  assert.equal(marks.length, 1);
  assert.match(String(marks[0]!.args[2]), /^roots=0 entries=2 ms=\d+(\.\d+)?$/);
  collection.stop();
});

test('~/x resolves under the home inferred from the config directory', async () => {
  const shell = createMemoryShell({
    '/Users/r/Library/Application Support/marxy/collection.toml': enc('[[root]]\npath = "~/x"\n\n[[root]]\npath = "~"\n'),
  });
  const mac = { ...shell, configPaths: async () => ({ config: '/Users/r/Library/Application Support/marxy/config.toml', data: '/d' }) };
  const { collection, warnings } = await loadCollection(mac, { notify: () => assert.fail('no notice') });
  assert.deepEqual(warnings, []);
  assert.deepEqual(collection.roots.map((r) => r.path), ['/Users/r/x', '/Users/r']);
});

test('declared folders are held in file order after the current root, then the recent roots; hits follow the scope', async () => {
  const h = harness('[[root]]\npath = "/b"\nwatch = false\n\n[[root]]\npath = "/a"\n', ['/c', '/r']);
  await h.shell.writeFileAtomic('/r/notes.md', enc('# Notes in r\n'));
  const collection = await h.start();
  await collection.loaded;
  assert.deepEqual(h.index.roots().slice(0, 3), ['/c', '/b', '/a']);
  assert.equal(h.index.isWatched('/b'), false);
  assert.equal(h.index.isWatched('/a'), true);
  await collection.recentLoaded;
  assert.deepEqual(h.index.roots(), ['/c', '/b', '/a', '/r']);
  assert.deepEqual(h.search('notes'), ['/c/notes.md', '/b/notes.md', '/a/notes.md', '/r/notes.md']);
  collection.stop();
});

test('rewriting collection.toml and its watch event drop a folder and add another, with no restart', async () => {
  const h = harness('[[root]]\npath = "/a"\n\n[[root]]\npath = "/b"\n');
  const collection = await h.start();
  await collection.loaded;
  assert.deepEqual(h.search('notes'), ['/c/notes.md', '/a/notes.md', '/b/notes.md']);
  await h.shell.writeFileAtomic('/collection.toml', enc('[[root]]\npath = "/b"\n'));
  h.shell.emit([{ kind: 'modified', path: '/elsewhere.toml' }]);
  await collection.settled();
  assert.deepEqual(h.search('notes'), ['/c/notes.md', '/a/notes.md', '/b/notes.md'], 'another file in the directory changes nothing');
  h.shell.emit([{ kind: 'renamed', path: '/collection.toml.tmp', to: '/collection.toml' }]);
  await collection.settled();
  assert.deepEqual(h.search('notes'), ['/c/notes.md', '/b/notes.md']);
  assert.deepEqual(h.index.roots(), ['/c', '/b']);
  assert.equal(h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'collection_loaded').length, 1, 'marked once, at launch');
  collection.stop();
});

/** /c is a repository holding the declared /c/docs; /r is a recent root holding the declared /r/n. */
function leakHarness() {
  const shell = createMemoryShell({
    '/c/.git/HEAD': enc('ref: refs/heads/main\n'),
    '/c/README.md': enc('# Home\n'),
    '/c/docs/guide.md': enc('# Guide\n'),
    '/c/docs/drafts/secret.md': enc('# Secret\n'),
    '/r/n/kept.md': enc('# Kept\n'),
    '/r/n/drafts/secret-r.md': enc('# Secret r\n'),
    '/collection.toml': enc('[[root]]\npath = "/c/docs"\n\n[[root]]\npath = "/r/n"\n\n[deny]\nglobs = ["**/drafts/**"]\n'),
  });
  const index = createIndexService(shell);
  const session = { ...emptySession('/c'), recentRoots: ['/c', '/r'] };
  const feed = createIndexFeed({
    currentRoot: () => session.currentRoot,
    recentRoots: () => session.recentRoots,
    readAt: () => session.readAt,
  });
  index.subscribe((entries) => feed.setEntries(entries));
  const search = (q: string) =>
    paletteResults(q, feed.entries(), session, { prepared: feed.prepared(), rootRank: feed.rootRank() }).map(
      (hit) => `${hit.entry.root}|${hit.entry.path}`,
    );
  return { shell, index, feed, session, search };
}

test('a deny glob holds through the repository that contains a declared folder (C-10 review)', async () => {
  const h = leakHarness();
  await h.index.ensureFor('/c/README.md');
  const collection = startCollection({
    shell: h.shell,
    index: h.index,
    feed: h.feed,
    currentPath: () => '/c/README.md',
    recentRoots: () => h.session.recentRoots,
    notify: () => {},
  });
  await collection.loaded;
  await collection.recentLoaded;
  assert.deepEqual(h.search('secret'), [], 'neither /c|…/drafts/secret.md nor /r|…/drafts/secret-r.md');
  assert.ok(h.search('guide').length > 0 && h.search('kept').length > 0, 'the rest is there');
  collection.stop();
});

test('a deny glob holds through a recent root that contains a declared folder (C-10 review)', async () => {
  const h = leakHarness();
  const collection = startCollection({
    shell: h.shell,
    index: h.index,
    feed: h.feed,
    currentPath: () => null,
    recentRoots: () => ['/r'],
    notify: () => {},
  });
  await collection.loaded;
  await collection.recentLoaded;
  assert.ok(h.index.roots().includes('/r'));
  assert.deepEqual(h.search('secret'), []);
  collection.stop();
});

test('a declared / or C:/ is skipped and the one notice says so (C-10 review)', async () => {
  const h = harness('[[root]]\npath = "/"\n\n[[root]]\npath = "C:/"\n\n[[root]]\npath = "/a"\n');
  const collection = await h.start();
  await collection.loaded;
  assert.deepEqual(h.index.roots(), ['/c', '/a'], 'only /a is held');
  assert.equal(h.notices.length, 1, JSON.stringify(h.notices));
  assert.match(h.notices[0]!, /\/ is a whole disk, too large to index; skipped/);
  // A bare drive is already refused by the parse (it normalises to `C:`, not an absolute folder).
  assert.match(h.notices[0]!, /"C:\/".*skipped/);
  assert.equal(h.shell.calls.filter((c) => c.method === 'readDir' && c.args[0] === '/').length, 0, '/ was never listed');
  collection.stop();
});

test('collection.toml broken mid-run keeps the last good folders, with one notice (C-10 review)', async () => {
  const h = harness('[[root]]\npath = "/a"\n');
  const collection = await h.start();
  await collection.loaded;
  assert.equal(h.notices.length, 0);
  await h.shell.writeFileAtomic('/collection.toml', enc('[[root]\npath = "/a"\n'));
  h.shell.emit([{ kind: 'modified', path: '/collection.toml' }]);
  await collection.settled();
  assert.equal(h.notices.length, 1, JSON.stringify(h.notices));
  assert.match(h.notices[0]!, /could not be parsed/, 'the core warning text this relies on (UNPARSEABLE_WARNING)');
  assert.deepEqual(h.index.roots(), ['/c', '/a']);
  assert.deepEqual(h.search('notes'), ['/c/notes.md', '/a/notes.md']);
  collection.stop();
});

test('adding a glob to collection.toml mid-run hides a file through every root, with no restart (C-10 review 2)', async () => {
  // No declared folder to wait on: the reload is applied the moment it is read, before any re-walk.
  const h = harness('');
  await h.shell.writeFileAtomic('/c/drafts/plan.md', enc('# Plan notes\n'));
  const collection = await h.start();
  await collection.loaded;
  assert.ok(h.search('plan').includes('/c/drafts/plan.md'));
  await h.shell.writeFileAtomic('/collection.toml', enc('[deny]\nglobs = ["**/drafts/**"]\n'));
  h.shell.emit([{ kind: 'modified', path: '/collection.toml' }]);
  await collection.settled();
  assert.deepEqual(h.search('plan'), [], 'gone once the reload is applied, before any re-walk');
  collection.stop();
});
