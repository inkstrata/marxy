// The palette index has an owner (A-04): one walk per repository root, every root opened published.
// WebKit: the three scenarios of the October 2026 audit (01-codebase-audit.md §1.3 [C9]), edits that
// no longer re-walk [C10], and history.json roots. Node: the service over a memory shell, and index
// reads through the Tauri shell's peekFile so they never land in its stale-write table.
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { build } from 'vite';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createMemoryShell } from '../src/shell/memory.ts';
import { createIndexService, indexShellFor } from '../src/index/service.ts';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'marxy-index-service-'));
let server;
let base;

const enc = (s) => new TextEncoder().encode(s);

/** Two repositories: `/a` has its notes one directory down, `/b` at the top. */
const twoRepos = () => ({
  '/a/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/a/README.md': enc('# Alpha\n\nThe first repository.\n'),
  '/a/docs/field-notes.md': enc('# Field notes\n\nWritten in the first repository.\n'),
  '/b/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/b/README.md': enc('# Bravo\n\nThe second repository.\n'),
  '/b/notes.md': enc('# Notes\n\nWritten in the second repository.\n'),
});

const toB64 = (files) =>
  Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes).toString('base64')]));

before(async () => {
  if (skip) return;
  await build({
    root: desktopRoot,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: { paletteBoot: join(desktopRoot, 'test/palette-boot.html') } },
    },
  });
  const types = { '.html': 'text/html', '.ttf': 'font/ttf', '.js': 'text/javascript', '.txt': 'text/plain', '.css': 'text/css' };
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = join(outDir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!existsSync(path)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

// ---------------------------------------------------------------------------------------------
// Node: the service itself.

nodeTest('ensureFor twice on one root walks it once; two roots publish the union, latest first', async () => {
  const shell = createMemoryShell(twoRepos());
  const service = createIndexService(shell);
  const seen = [];
  service.subscribe((entries) => seen.push(entries.map((e) => e.path)));
  assert.deepEqual(seen, [[]], 'subscribe calls back at once');

  await Promise.all([service.ensureFor('/a/README.md'), service.ensureFor('/a/docs/field-notes.md')]);
  const readDirs = () => shell.calls.filter((c) => c.method === 'readDir').length;
  const listed = readDirs();
  await service.ensureFor('/a/README.md');
  const walksOf = (root) =>
    shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded' && String(c.args[2]).includes(`root=${root}`)).length;
  assert.equal(walksOf('/a'), 1, 'three ensureFor calls on /a share one walk');
  assert.equal(readDirs(), listed, 'ensuring a walked root lists nothing again');
  assert.deepEqual([...service.entries()].map((e) => e.path).sort(), ['/a/README.md', '/a/docs/field-notes.md']);

  await service.ensureFor('/b/README.md');
  assert.equal(walksOf('/b'), 1);
  assert.deepEqual(
    service.entries().map((e) => e.root),
    ['/b', '/b', '/a', '/a'],
    'the union of both roots, the most recently ensured first',
  );
  assert.deepEqual(seen.at(-1), service.entries().map((e) => e.path), 'subscribers get the union');

  await service.ensureFor('/a/README.md');
  assert.equal(walksOf('/a'), 1, 'ensuring /a again does not walk it again');
  assert.deepEqual(service.entries().map((e) => e.root), ['/a', '/a', '/b', '/b'], 'but moves it to the front');
});

nodeTest('rootFor is the repository root, cached per directory', async () => {
  const shell = createMemoryShell(twoRepos());
  const service = createIndexService(shell);
  assert.equal(await service.rootFor('/a/docs/field-notes.md'), '/a');
  const readDirs = shell.calls.filter((c) => c.method === 'readDir').length;
  assert.equal(await service.rootFor('/a/docs/other.md'), '/a');
  assert.equal(shell.calls.filter((c) => c.method === 'readDir').length, readDirs, 'a second file in the directory costs nothing');
  assert.equal(await service.rootFor('/b/notes.md'), '/b');
});

nodeTest('refresh re-walks an indexed root once for a burst of calls, and ignores unindexed roots', async () => {
  const shell = createMemoryShell(twoRepos());
  const service = createIndexService(shell);
  await service.ensureFor('/b/README.md');
  const walks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded').length;
  assert.equal(walks(), 1);
  await shell.writeFileAtomic('/b/later.md', enc('# Later\n'));
  service.refresh('/b');
  service.refresh('/b');
  service.refresh('/b');
  service.refresh('/a');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(walks(), 2, 'three refreshes coalesce into one walk; /a was never ensured');
  assert.ok(service.entries().some((e) => e.path === '/b/later.md'), 'the re-walk publishes the new file');
});

nodeTest('a first walk that fails is not cached: the next ensureFor walks the root again', async () => {
  const shell = createMemoryShell(twoRepos());
  const readDir = shell.readDir;
  let failures = 0;
  const flaky = {
    ...shell,
    // Root detection lists /b first; the walk's own listing of /b is the second call and fails once.
    readDir: async (dir) => {
      if (dir === '/b' && failures === 0 && shell.calls.some((c) => c.method === 'readDir' && c.args[0] === '/b')) {
        failures++;
        throw new Error('io: transient');
      }
      return readDir(dir);
    },
  };
  const service = createIndexService(flaky);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await service.ensureFor('/b/README.md');
  } finally {
    console.warn = warn;
  }
  assert.equal(failures, 1, 'the walk failed once');
  assert.deepEqual(service.entries(), []);
  await service.ensureFor('/b/README.md');
  assert.deepEqual(service.entries().map((e) => e.path).sort(), ['/b/README.md', '/b/notes.md'], 'the retry walked /b');
});

// A-05: the snapshot, and a walk that reads only what it must.

const sha1 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Three directories, one .gitignore, four markdown files. */
const snapshotRepo = () => ({
  '/r/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/r/.gitignore': enc('scratch/\n'),
  '/r/README.md': enc('# Rho\n\nTop.\n'),
  '/r/docs/guide.md': enc('# Guide\n\n## Install\n'),
  '/r/docs/deep/notes.md': enc('# Notes\n'),
  '/r/docs/deep/more.md': enc('# More\n\n## Detail\n'),
});

/** A memory shell whose listings report a settable modification time per path. */
const stampedShell = (files, mtimes = new Map()) => {
  const shell = createMemoryShell(files);
  const readDir = shell.readDir;
  return {
    shell,
    mtimes,
    host: {
      ...shell,
      readDir: async (dir) => (await readDir(dir)).map((s) => ({ ...s, mtimeMs: mtimes.get(s.path) ?? s.mtimeMs })),
    },
  };
};

const walkCalls = (shell, method) =>
  // The collection.toml read (C-10) is the deny list's, not the walk's; `.git` and `.git/HEAD` are
  // C-15's probes for which checkout a folder is (counted in the test that names them).
  shell.calls.filter((c) => c.method === method && !String(c.args[0]).startsWith('/data/') && c.args[0] !== '/collection.toml' && !isGitProbe(c));

const isGitProbe = (c) => c.method === 'readFile' && /\/\.git(\/HEAD)?$/.test(String(c.args[0]));

nodeTest('a cold walk makes exactly one readDir per directory, one read per ignore file and one per markdown file', async () => {
  const { shell, host } = stampedShell(snapshotRepo());
  const service = createIndexService(host);
  await service.rootFor('/r/README.md');
  const probes = walkCalls(shell, 'readDir').length; // root detection lists the opened file's directory
  await service.ensureFor('/r/README.md');
  assert.equal(walkCalls(shell, 'readDir').length - probes, 3, 'readDir x directories (/r, /r/docs, /r/docs/deep)');
  assert.equal(walkCalls(shell, 'readFile').length, 1 + 4, 'readFile x ignore files present + x markdown files');
  const mark = shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded').map((c) => c.args[2]);
  assert.equal(mark.length, 1);
  assert.match(mark[0], /source=walk calls=8$/, 'calls= counts the walk: 3 listings + 1 ignore file + 4 markdown files');
  assert.deepEqual(service.entries().map((e) => e.path).sort(), ['/r/README.md', '/r/docs/deep/more.md', '/r/docs/deep/notes.md', '/r/docs/guide.md']);
});

nodeTest('a directory with no ignore file costs no ignore probe', async () => {
  const { shell, host } = stampedShell({ '/r/.git/HEAD': enc('x'), '/r/a/b/c.md': enc('# C\n'), '/r/a/d/e.md': enc('# E\n') });
  await createIndexService(host).ensureFor('/r/a/b/c.md');
  const read = walkCalls(shell, 'readFile').map((c) => c.args[0]);
  assert.deepEqual(read.sort(), ['/r/a/b/c.md', '/r/a/d/e.md'], `only markdown was read: ${read}`);
});

nodeTest('the snapshot is written under the data directory, named by the root hash', async () => {
  const { shell, host } = stampedShell(snapshotRepo());
  await createIndexService(host).ensureFor('/r/README.md');
  const path = `/data/index-${await sha1('/r')}.json`;
  assert.ok(shell.hasFile(path), `${path} written`);
  const snapshot = JSON.parse(new TextDecoder().decode(await shell.readFile(path)));
  assert.equal(snapshot.root, '/r');
  assert.equal(snapshot.entries.length, 4);
});

nodeTest('a fresh session publishes the snapshot before its first listing resolves and reads no markdown when nothing changed', async () => {
  const { shell: first, host: firstHost } = stampedShell(snapshotRepo());
  await createIndexService(firstHost).ensureFor('/r/README.md');
  const snapshotPath = `/data/index-${await sha1('/r')}.json`;

  // The same tree and the snapshot, in a new session.
  const files = { ...snapshotRepo(), [snapshotPath]: await first.readFile(snapshotPath) };
  const { shell, host } = stampedShell(files);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const gated = { ...host, readDir: async (dir) => { await gate; return host.readDir(dir); } };
  // Root detection needs listings too, so let the probe through before closing the gate.
  const service = createIndexService({ ...gated, readDir: (dir) => (dir === '/r' && released ? host.readDir(dir) : gated.readDir(dir)) });
  let released = true;
  await service.rootFor('/r/README.md');
  released = false;
  const ensuring = service.ensureFor('/r/README.md');
  const deadline = Date.now() + 2000;
  while (service.entries().length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  assert.equal(service.entries().length, 4, 'entries are published while the listing is still pending');
  assert.ok(shell.calls.some((c) => c.method === 'mark' && /source=snapshot/.test(String(c.args[2]))), 'marked source=snapshot');
  release();
  await ensuring;
  assert.equal(walkCalls(shell, 'readFile').filter((c) => String(c.args[0]).endsWith('.md')).length, 0, 'no markdown was read');
  assert.ok(shell.calls.some((c) => c.method === 'mark' && /source=walk calls=4$/.test(String(c.args[2]))), 'the check made 3 listings + 1 ignore file');
  assert.equal(shell.calls.filter((c) => c.method === 'writeFileAtomic').length, 0, 'an unchanged tree rewrites nothing');
});

nodeTest('one changed file is the only markdown read, and its headings are updated', async () => {
  const mtimes = new Map();
  const { shell: first, host: firstHost } = stampedShell(snapshotRepo(), mtimes);
  await createIndexService(firstHost).ensureFor('/r/README.md');
  const snapshotPath = `/data/index-${await sha1('/r')}.json`;

  const files = { ...snapshotRepo(), '/r/docs/guide.md': enc('# Guide, revised\n\n## Install\n\n## Upgrade\n'), [snapshotPath]: await first.readFile(snapshotPath) };
  const { shell, host } = stampedShell(files, new Map([['/r/docs/guide.md', 99]]));
  const service = createIndexService(host);
  await service.ensureFor('/r/README.md');
  const read = walkCalls(shell, 'readFile').map((c) => c.args[0]).filter((p) => p.endsWith('.md'));
  assert.deepEqual(read, ['/r/docs/guide.md']);
  const guide = service.entries().find((e) => e.path === '/r/docs/guide.md');
  assert.equal(guide.title, 'Guide, revised');
  assert.deepEqual(guide.headings.map((h) => h.text), ['Guide, revised', 'Install', 'Upgrade']);
  assert.equal(guide.mtimeMs, 99);
  assert.ok(shell.calls.some((c) => c.method === 'writeFileAtomic'), 'the new snapshot is written');
});

nodeTest('a snapshot entry whose file is gone is replaced by the walk, and a corrupt snapshot is ignored', async () => {
  const { shell: first, host: firstHost } = stampedShell(snapshotRepo());
  await createIndexService(firstHost).ensureFor('/r/README.md');
  const snapshotPath = `/data/index-${await sha1('/r')}.json`;
  const files = snapshotRepo();
  delete files['/r/docs/deep/more.md'];
  const gone = stampedShell({ ...files, [snapshotPath]: await first.readFile(snapshotPath) });
  const goneService = createIndexService(gone.host);
  await goneService.ensureFor('/r/README.md');
  assert.ok(!goneService.entries().some((e) => e.path === '/r/docs/deep/more.md'));

  const bad = stampedShell({ ...snapshotRepo(), [snapshotPath]: enc('{not json') });
  const badService = createIndexService(bad.host);
  await badService.ensureFor('/r/README.md');
  assert.equal(badService.entries().length, 4);
  assert.equal(JSON.parse(new TextDecoder().decode(await bad.shell.readFile(snapshotPath))).entries.length, 4, 'the bad file is overwritten');
});

nodeTest('a snapshot with a malformed entry is no snapshot: the walk still runs and publishes', async () => {
  const snapshotPath = `/data/index-${await sha1('/r')}.json`;
  const good = { path: '/r/README.md', root: '/r', title: 'Rho', headings: [], mtimeMs: 1, size: 12, kind: 'markdown' };
  const { headings: _h, ...noHeadings } = good;
  for (const entries of [[null], [noHeadings], [{ ...good, size: '12' }], [{ ...good, kind: 'nope' }]]) {
    const snapshot = JSON.stringify({ version: 1, root: '/r', generatedAtMs: 1, entries });
    const { shell, host } = stampedShell({ ...snapshotRepo(), [snapshotPath]: enc(snapshot) });
    const service = createIndexService(host);
    const seen = [];
    service.subscribe((e) => seen.push(e.map((x) => x.path)));
    await service.ensureFor('/r/README.md');
    assert.ok(!shell.calls.some((c) => c.method === 'mark' && /source=snapshot/.test(String(c.args[2]))), 'nothing was served from it');
    assert.equal(service.entries().length, 4, JSON.stringify(entries));
    assert.ok(seen.every((e) => e.length === 0 || e.length === 4), 'no malformed entry was ever published');
    assert.equal(JSON.parse(new TextDecoder().decode(await shell.readFile(snapshotPath))).entries.length, 4, 'the walk overwrote it');
  }
});

nodeTest('a walk that throws after the snapshot was served unpublishes its rows, and the next ensureFor retries', async () => {
  const snapshotPath = `/data/index-${await sha1('/r')}.json`;
  const { shell: written } = stampedShell(snapshotRepo());
  await createIndexService(written).ensureFor('/r/README.md');
  const { shell, host } = stampedShell({ ...snapshotRepo(), [snapshotPath]: await written.readFile(snapshotPath) });
  let failing = false;
  const flaky = { ...host, readDir: async (dir) => { if (failing) throw new Error('io: transient'); return host.readDir(dir); } };
  const service = createIndexService(flaky);
  await service.rootFor('/r/README.md');
  failing = true;
  const warn = console.warn;
  console.warn = () => {};
  const seen = [];
  service.subscribe((e) => seen.push(e.length));
  try {
    await service.ensureFor('/r/README.md');
  } finally {
    console.warn = warn;
  }
  assert.ok(seen.includes(4), 'the snapshot was published first');
  assert.deepEqual(service.entries(), [], 'the failed walk unpublished the served rows');
  failing = false;
  await service.ensureFor('/r/README.md');
  assert.equal(service.entries().length, 4, 'the retry walked and published');
  assert.ok(shell.calls.some((c) => c.method === 'mark' && /source=walk/.test(String(c.args[2]))));
});

nodeTest('a root .gitignore hides a file that exists, and the walk reads it', async () => {
  const { host } = stampedShell({ ...snapshotRepo(), '/r/.gitignore': enc('hidden.md\nscratch/\n'), '/r/hidden.md': enc('# Hidden\n'), '/r/scratch/s.md': enc('# S\n') });
  const service = createIndexService(host);
  await service.ensureFor('/r/README.md');
  const paths = service.entries().map((e) => e.path);
  assert.ok(!paths.includes('/r/hidden.md') && !paths.includes('/r/scratch/s.md'), `ignored files are not indexed: ${paths}`);
  assert.equal(paths.length, 4);
});

// C-10: declared folders are held with ensureRoot and let go with dropRoot; each root keeps a baseline.

nodeTest('a second service instance over the same data directory reports the same baselineMs (C-10)', async () => {
  const shell = createMemoryShell(snapshotRepo());
  const first = createIndexService(shell);
  assert.equal(first.baselineMs('/r'), undefined, 'no baseline before the root is indexed');
  await first.ensureRoot('/r');
  const baseline = first.baselineMs('/r');
  assert.equal(typeof baseline, 'number');
  await new Promise((resolve) => setTimeout(resolve, 15));
  await shell.writeFileAtomic('/r/docs/later.md', enc('# Later\n'));
  const second = createIndexService(shell);
  await second.ensureRoot('/r');
  assert.ok(second.entries().some((e) => e.path === '/r/docs/later.md'), 'the second instance walked the root again');
  assert.equal(second.baselineMs('/r'), baseline, 'the baseline is kept in the snapshot and never moves');
});

nodeTest('a snapshot\'s baselineMs is served as kept, not replaced by its generatedAtMs or the walk time (C-10)', async () => {
  const shell = createMemoryShell(snapshotRepo());
  const snapshot = {
    version: 1,
    root: '/r',
    generatedAtMs: 1_700_000_500_000,
    baselineMs: 1_600_000_000_000,
    entries: [{ path: '/r/README.md', root: '/r', title: 'Rho', mtimeMs: 1, size: 12, kind: 'markdown', headings: [] }],
  };
  await shell.writeFileAtomic(`/data/index-${await sha1('/r')}.json`, enc(JSON.stringify(snapshot)));
  const service = createIndexService(shell);
  await service.ensureRoot('/r');
  assert.equal(service.baselineMs('/r'), 1_600_000_000_000);
  const kept = JSON.parse(new TextDecoder().decode(await shell.readFile(`/data/index-${await sha1('/r')}.json`)));
  assert.equal(kept.baselineMs, 1_600_000_000_000, 'the rewritten snapshot carries the same baseline');
});

nodeTest('ensureRoot holds a folder as itself; dropRoot lets it go; isWatched follows the declaration (C-10)', async () => {
  const shell = createMemoryShell({
    '/c/.git/HEAD': enc('ref: refs/heads/main\n'),
    '/c/README.md': enc('# Home\n'),
    '/c/sub/a.md': enc('# A\n'),
    '/d/b.md': enc('# B\n'),
  });
  const service = createIndexService(shell);
  await service.ensureFor('/c/README.md');
  await service.ensureRoot('/c/sub', { watch: true });
  await service.ensureRoot('/d', { watch: false });
  const of = (root) => service.entries().filter((e) => e.root === root).map((e) => e.path).sort();
  assert.deepEqual(of('/c/sub'), ['/c/sub/a.md'], 'the declared folder is its own root');
  assert.deepEqual(service.roots(), ['/c', '/c/sub', '/d']);
  assert.equal(service.isWatched('/c'), true, 'the open document\'s repository counts as watched');
  assert.equal(service.isWatched('/c/sub'), true);
  assert.equal(service.isWatched('/d'), false, 'watch = false');
  assert.equal(shell.calls.filter((c) => c.method === 'watch').length, 0, 'nothing is watched here (C-11 starts watches)');
  service.dropRoot('/d');
  assert.deepEqual(of('/d'), []);
  assert.deepEqual(service.roots(), ['/c', '/c/sub']);
  assert.equal(service.isWatched('/d'), false);
});

/** A repository /c holding a declared folder /c/docs, and a recent root /r holding a declared /r/n. */
const deniedTree = (collection) => ({
  '/c/.git/HEAD': enc('ref: refs/heads/main\n'),
  '/c/README.md': enc('# Home\n'),
  '/c/docs/guide.md': enc('# Guide\n'),
  '/c/docs/drafts/secret.md': enc('# Secret\n'),
  '/r/n/drafts/secret-r.md': enc('# Secret r\n'),
  '/r/n/kept.md': enc('# Kept\n'),
  ...(collection === undefined ? {} : { '/collection.toml': enc(collection) }),
});
const DENY_DRAFTS = '[[root]]\npath = "/c/docs"\n\n[[root]]\npath = "/r/n"\n\n[deny]\nglobs = ["**/drafts/**"]\n';

nodeTest('the deny globs hold for the current repository and a recent root, not only the declared folders (C-10)', async () => {
  const shell = createMemoryShell(deniedTree(DENY_DRAFTS));
  const service = createIndexService(shell);
  // The repository's first walk already honours collection.toml: it is read before any walk.
  await service.ensureFor('/c/README.md');
  await service.ensureRoot('/c/docs');
  await service.ensureRoot('/r');
  await service.ensureRoot('/r/n');
  const paths = service.entries().map((e) => `${e.root} ${e.path}`);
  assert.ok(!paths.some((p) => p.includes('/drafts/')), `no drafts through any root: ${JSON.stringify(paths)}`);
  assert.ok(paths.includes('/c /c/docs/guide.md') && paths.includes('/r /r/n/kept.md'), JSON.stringify(paths));
  assert.equal(
    shell.calls.filter((c) => c.method === 'readFile' && String(c.args[0]).includes('/drafts/')).length,
    0,
    'nothing under a deny glob is read',
  );
});

nodeTest('setDeny with new globs re-walks every root held, and an emptied list brings the files back (C-10)', async () => {
  const { denyRulesFor } = await import('@marxy/core/src/index-model/collection.ts');
  const shell = createMemoryShell(deniedTree(undefined));
  const service = createIndexService(shell);
  await service.ensureFor('/c/README.md');
  await service.ensureRoot('/r');
  const drafts = () => service.entries().filter((e) => e.path.includes('/drafts/')).map((e) => e.path).sort();
  assert.deepEqual(drafts(), ['/c/docs/drafts/secret.md', '/r/n/drafts/secret-r.md']);
  service.setDeny(denyRulesFor(['**/drafts/**']));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(drafts(), [], 'both roots were walked again with the rule');
  service.setDeny([]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(drafts(), ['/c/docs/drafts/secret.md', '/r/n/drafts/secret-r.md'], 'no rule lingers');
});

nodeTest('a glob added while Marxy was closed: the last snapshot never publishes the denied file (C-10 review 2)', async () => {
  const shell = createMemoryShell(deniedTree(undefined));
  const first = createIndexService(shell);
  await first.ensureFor('/c/README.md');
  assert.ok(first.entries().some((e) => e.path === '/c/docs/drafts/secret.md'), 'the snapshot holds the draft');
  await shell.writeFileAtomic('/collection.toml', enc('[deny]\nglobs = ["**/drafts/**"]\n'));
  const second = createIndexService(shell);
  const published = [];
  second.subscribe((entries) => published.push(entries.map((e) => e.path)));
  await second.ensureFor('/c/README.md');
  assert.ok(
    shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'index_loaded' && String(c.args[2]).includes('source=snapshot')),
    'the second session served its snapshot',
  );
  assert.ok(!published.some((paths) => paths.some((p) => p.includes('/drafts/'))), JSON.stringify(published));
});

nodeTest('setDeny hides a matching entry at once, before its re-walk resolves (C-10 review 2)', async () => {
  const { denyRulesFor } = await import('@marxy/core/src/index-model/collection.ts');
  const shell = createMemoryShell(deniedTree(undefined));
  const service = createIndexService(shell);
  await service.ensureFor('/c/README.md');
  await service.ensureRoot('/r');
  const walks = () => shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded').length;
  const before = walks();
  service.setDeny(denyRulesFor(['**/drafts/**']));
  assert.equal(walks(), before, 'no re-walk has run yet');
  assert.deepEqual(service.entries().filter((e) => e.path.includes('/drafts/')), [], 'hidden synchronously');
});

nodeTest('index reads go through peekFile: none lands in the Tauri shell lastRead', async () => {
  register('./support/tauri-stub-hooks.mjs', import.meta.url);
  globalThis.navigator ??= { platform: 'MacIntel' };
  const { fs } = await import('./support/tauri-core-stub.mjs');
  const { shell: tauri } = await import('../src/shell/tauri.ts');
  for (const [path, bytes] of Object.entries(twoRepos())) fs.set(path, bytes);
  // The stub has no read_dir or mark command; the memory shell lists the same tree.
  const lister = createMemoryShell(twoRepos());
  const host = { ...tauri, readDir: lister.readDir, mark: async () => {} };
  const peeked = [];
  const peekFile = tauri.peekFile;
  host.peekFile = (path) => {
    peeked.push(path);
    return peekFile(path);
  };

  const service = createIndexService(indexShellFor(host));
  await service.ensureFor('/b/README.md');
  assert.ok(peeked.includes('/b/notes.md'), `index reads go through peekFile (peeked ${peeked.join(', ')})`);

  // lastRead is private; a write is refused when it holds bytes that disk no longer matches. Change a
  // file the index read, then write it: had the index read armed the guard, the write would refuse.
  fs.set('/b/notes.md', enc('# Notes\n\nChanged by another program.\n'));
  await tauri.writeFileAtomic('/b/notes.md', enc('# Notes\n\nWritten by Marxy.\n'));
  assert.equal(new TextDecoder().decode(fs.get('/b/notes.md')), '# Notes\n\nWritten by Marxy.\n');

  // The control: the same sequence through readFile does arm the guard, so the check above can fail.
  await tauri.readFile('/b/README.md');
  fs.set('/b/README.md', enc('# Bravo, changed\n'));
  await assert.rejects(() => tauri.writeFileAtomic('/b/README.md', enc('# Bravo, written\n')));
});

// ---------------------------------------------------------------------------------------------
// WebKit: the palette over the real app.

async function launch(argv, fn, opts) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
    await page.goto(`${base}test/palette-boot.html`);
    await page.waitForFunction(() => typeof window.marxyPaletteBoot?.start === 'function');
    await page.evaluate(async ({ files, argv, opts }) => {
      const { handle } = await window.marxyPaletteBoot.start(files, argv, undefined, opts);
      window.__h = handle;
    }, { files: toB64(twoRepos()), argv, opts });
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, mod);
  } finally {
    await browser.close();
  }
}

/** Waits for the walk of `root` to be published (its `index_loaded` mark). */
function indexed(page, root) {
  return page.waitForFunction(
    (r) => window.__h.shell.calls.some((c) => c.method === 'mark' && c.args[0] === 'index_loaded' && String(c.args[2]).includes(`root=${r}`)),
    root,
  );
}

/** Types `query` in the palette and returns the rows' text. */
async function search(page, mod, query) {
  await page.keyboard.press(`${mod}+KeyP`);
  await page.waitForSelector('#marxy-palette[open]');
  await page.fill('#marxy-palette .marxy-palette-query', query);
  const rows = await page.$$eval('#marxy-palette .marxy-palette-row', (els) =>
    // A row's title, without the age a watched root's row carries beside it (C-12).
    els.map((el) => (el.querySelector('.marxy-palette-title') ?? el).textContent ?? ''),
  );
  await page.keyboard.press('Escape');
  return rows;
}

test('control: launch with /b/README.md, and "notes" finds Notes', () =>
  launch(['/b/README.md'], async (page, mod) => {
    await indexed(page, '/b');
    const rows = await search(page, mod, 'notes');
    assert.ok(rows.some((r) => r.includes('Notes')), `rows: ${JSON.stringify(rows)}`);
  }));

test('launch with no document, then open /b/README.md: "notes" finds Notes', () =>
  launch([], async (page, mod) => {
    await page.evaluate(() => window.__h.open('/b/README.md'));
    await indexed(page, '/b');
    const rows = await search(page, mod, 'notes');
    assert.ok(rows.some((r) => r.includes('Notes')), `rows: ${JSON.stringify(rows)}`);
  }));

test('launch with /a/README.md, then open /b/README.md: "notes" finds both repositories', () =>
  launch(['/a/README.md'], async (page, mod) => {
    await indexed(page, '/a');
    await page.evaluate(() => window.__h.open('/b/README.md'));
    await indexed(page, '/b');
    const rows = await search(page, mod, 'notes');
    assert.ok(rows.some((r) => /Notes/.test(r) && !/Field/.test(r)), `/b's Notes: ${JSON.stringify(rows)}`);
    assert.ok(rows.some((r) => r.includes('Field notes')), `/a's Field notes: ${JSON.stringify(rows)}`);
  }));

test('three commitEdit calls walk nothing: index_loaded and readDir counts stay put', () =>
  launch(['/a/README.md'], async (page) => {
    await indexed(page, '/a');
    const counts = await page.evaluate(async () => {
      const h = window.__h;
      const count = () => ({
        index_loaded: h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded').length,
        readDir: h.shell.calls.filter((c) => c.method === 'readDir').length,
      });
      const idle = () => new Promise((resolve) => setTimeout(resolve, 300));
      await idle();
      const before = count();
      for (let i = 0; i < 3; i++) {
        await h.commitEdit(h.openDocument().buffer);
        await idle();
      }
      return { before, after: count() };
    });
    assert.equal(counts.before.index_loaded, 1, JSON.stringify(counts));
    assert.deepEqual(counts.after, counts.before);
  }));

test('history.json records repository roots, /a and /b, not /a/docs', () =>
  launch(['/a/README.md'], async (page) => {
    // Opens are what history records (a launch document is not one), so open a file one level down.
    await page.evaluate(() => window.__h.open('/a/docs/field-notes.md'));
    await page.evaluate(() => window.__h.open('/b/README.md'));
    const history = await page.evaluate(async () => {
      await window.__h.shell.quit(0);
      return new TextDecoder().decode(await window.__h.shell.readFile('/data/history.json'));
    });
    const { recentRoots } = JSON.parse(history);
    assert.deepEqual(recentRoots, ['/b', '/a'], history);
  }));

// The open document's folder watch re-walks its root only when no tree watch covers it (C-11): here the
// shell refuses the tree watch, so the folder watch is what keeps /a fresh.
test("with no tree watch: the echo of Marxy's own save re-walks nothing; another markdown file's change re-walks the root", () =>
  launch(['/a/README.md'], async (page) => {
    await indexed(page, '/a');
    const counts = await page.evaluate(async () => {
      const h = window.__h;
      const count = () => ({
        index_loaded: h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded').length,
        readDir: h.shell.calls.filter((c) => c.method === 'readDir').length,
      });
      const idle = () => new Promise((resolve) => setTimeout(resolve, 300));
      const until = async (ok) => {
        const deadline = performance.now() + 5000;
        while (!ok() && performance.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      };
      const watchReads = () => h.shell.calls.filter((c) => c.method === 'readFile' && c.args[0] === '/a/README.md').length;
      await idle();
      // An edit, then the save's bytes reach disk and the watcher reports the open document.
      await h.commitEdit(h.openDocument().buffer);
      await h.shell.writeFileAtomic('/a/README.md', h.openDocument().buffer.bytes);
      const before = count();
      let reads = watchReads();
      h.shell.emit([{ kind: 'modified', path: '/a/README.md' }]);
      await until(() => watchReads() > reads);
      await idle();
      const echo = count();
      // The control: a different markdown file in the directory changes.
      await h.shell.writeFileAtomic('/a/later.md', new TextEncoder().encode('# Later\n'));
      reads = watchReads();
      h.shell.emit([{ kind: 'created', path: '/a/later.md' }]);
      await until(() => count().index_loaded > echo.index_loaded);
      const other = count();
      return { before, echo, other };
    });
    assert.deepEqual(counts.echo, counts.before, `the save echo walked: ${JSON.stringify(counts)}`);
    assert.equal(counts.other.index_loaded, counts.echo.index_loaded + 1, `another file did not re-walk: ${JSON.stringify(counts)}`);
    assert.ok(counts.other.readDir > counts.echo.readDir);
  }, { refuseTreeWatch: true }));

test('with a live tree watch: neither the save echo nor another file re-walks the root; the new file is patched in (C-11)', () =>
  launch(['/a/README.md'], async (page, mod) => {
    await indexed(page, '/a');
    const counts = await page.evaluate(async () => {
      const h = window.__h;
      await h.trees.settled();
      await h.index.settled();
      const walks = () => h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'index_loaded').length;
      const before = walks();
      await h.commitEdit(h.openDocument().buffer);
      await h.shell.writeFileAtomic('/a/README.md', h.openDocument().buffer.bytes);
      h.shell.emit([{ kind: 'modified', path: '/a/README.md' }]);
      await h.shell.writeFileAtomic('/a/later.md', new TextEncoder().encode('# Later\n'));
      h.shell.emit([{ kind: 'created', path: '/a/later.md' }]);
      await h.index.settled();
      return { trees: h.trees.trees(), before, after: walks(), listed: h.index.entries().some((e) => e.path === '/a/later.md') };
    });
    assert.deepEqual(counts.trees, ['/a'], 'the open repository is watched as a tree');
    assert.equal(counts.after, counts.before, `a walk ran: ${JSON.stringify(counts)}`);
    assert.ok(counts.listed, 'the new file is in the index');
    assert.ok((await search(page, mod, 'later')).includes('Later'), 'and in the palette');
  }));

// ---- C-15: which checkout a path is in ---------------------------------------------------------------

nodeTest('checkoutKey: worktrees of one repository share a group; a folder the walk hid is never probed (C-15)', async () => {
  const shell = createMemoryShell({
    '/r/.git/HEAD': enc('ref: refs/heads/main\n'),
    '/r/.gitignore': enc('hidden/\n'),
    '/r/AGENTS.md': enc('# Agents\n'),
    '/r/hidden/secret.md': enc('# Secret\n'),
    '/r/docs/guide.md': enc('# Guide\n'),
    '/wt/a/.git': enc('gitdir: /r/.git/worktrees/a\n'),
    '/wt/a/AGENTS.md': enc('# Agents\n'),
    '/wt/rel/.git': enc('gitdir: ../../r/.git/worktrees/rel\n'),
    '/wt/rel/AGENTS.md': enc('# Agents\n'),
    '/o/.git/HEAD': enc('ref: refs/heads/main\n'),
    '/o/AGENTS.md': enc('# Agents\n'),
    '/plain/AGENTS.md': enc('# Agents\n'),
  });
  const service = createIndexService(shell);
  for (const root of ['/r', '/wt/a', '/wt/rel', '/o', '/plain']) await service.ensureRoot(root);
  await service.settled();
  const key = (path) => service.checkoutKey(path);
  assert.deepEqual(key('/wt/a/AGENTS.md'), { group: '/r/.git', rel: 'AGENTS.md', checkout: '/wt/a' });
  assert.deepEqual(key('/r/docs/guide.md'), { group: '/r/.git', rel: 'docs/guide.md', checkout: '/r' });
  assert.equal(key('/wt/rel/AGENTS.md').group, '/r/.git', 'a relative gitdir is resolved against the checkout');
  assert.equal(key('/o/AGENTS.md').group, '/o/.git', 'an unrelated repository has its own group');
  assert.equal(key('/plain/AGENTS.md'), undefined, 'a folder with no .git has none');
  assert.equal(key('/elsewhere/AGENTS.md'), undefined);
  const probed = shell.calls.filter(isGitProbe).map((c) => c.args[0]);
  assert.ok(!probed.some((p) => p.includes('/hidden/')), `a hidden folder is not probed: ${probed}`);
  assert.ok(probed.every((p) => /\/\.git(\/HEAD)?$/.test(p)), 'only .git and .git/HEAD are read');
});
