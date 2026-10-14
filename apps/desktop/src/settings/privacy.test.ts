// The Privacy page's lists are computed from the code (W-12, ADR-0075): the "What can leave this Mac" table equals the shell's
// network-capable calls, every other call of the shell is placed as local, and the sentence "Nothing else leaves this Mac" is only drawn
// beside a table that passes this file.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LEAVES_THIS_MAC, LOCAL_ONLY_CALLS, NOTHING_ELSE, STORED_FILES, bytesText, storedOnThisMac } from './privacy.ts';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The members of `interface Shell` in shell-api, by name. */
function shellMembers(): string[] {
  const src = read('../../../../packages/shell-api/src/index.ts');
  const body = src.slice(src.indexOf('export interface Shell {'), src.indexOf('/** No-op Shell used only'));
  return [...body.matchAll(/^ {2}(?:readonly )?([A-Za-z]+)\s*[(:<]/gm)].map((m) => m[1]!);
}

test('the "What can leave this Mac" list equals the shell\'s network-capable calls: openExternal, fetchRemoteImage and the clipboard writes', () => {
  const leaving = LEAVES_THIS_MAC.flatMap((l) => l.calls).sort();
  assert.deepEqual(leaving, ['clipboardWrite', 'clipboardWriteItem', 'fetchRemoteImage', 'openExternal']);
  for (const row of LEAVES_THIS_MAC) {
    assert.ok(row.action && row.sends && row.to, `${row.id} says what it sends and to whom`);
  }
});

test('every call of the shell is placed: in the leaving table or in the local list, never both, so a new call without a row fails here', () => {
  const members = shellMembers();
  assert.ok(members.length >= 30 && members.includes('openExternal') && members.includes('readFile'), 'the Shell interface was found');
  const leaving = new Set(LEAVES_THIS_MAC.flatMap((l) => l.calls));
  const local = new Set(LOCAL_ONLY_CALLS);
  const unplaced = members.filter((m) => !leaving.has(m) && !local.has(m));
  assert.deepEqual(unplaced, [], `a call of shell-api has no row in privacy.ts (add it to LEAVES_THIS_MAC if it can send something off this Mac, else to LOCAL_ONLY_CALLS): ${unplaced.join(', ')}`);
  assert.deepEqual([...leaving].filter((m) => local.has(m)), [], 'a call is either local or leaves');
  const stale = [...leaving, ...local].filter((m) => !members.includes(m));
  assert.deepEqual(stale, [], 'a row names a call that the shell no longer has');
});

test('a row says whether the desktop shell has the call, and the shell source agrees', () => {
  const tauri = read('../shell/tauri.ts');
  for (const row of LEAVES_THIS_MAC) {
    for (const call of row.calls) {
      const defined = new RegExp(`^\\s+(?:async\\s+)?${call}\\s*[:(]`, 'm').test(tauri) || new RegExp(`['"]${call}['"]`).test(tauri);
      assert.equal(defined, row.built, `${row.id}: ${call} is ${defined ? '' : 'not '}in shell/tauri.ts, so built must be ${defined}`);
    }
  }
});

test('nothing else leaves: the Rust shell depends on no network crate', () => {
  const cargo = read('../../src-tauri/Cargo.toml');
  const deps = cargo.slice(cargo.indexOf('[dependencies]'));
  for (const crate of ['reqwest', 'ureq', 'hyper', 'isahc', 'attohttpc', 'surf', 'curl', 'tokio-tungstenite', 'tungstenite', 'tauri-plugin-http', 'tauri-plugin-updater', 'tauri-plugin-websocket']) {
    assert.ok(!new RegExp(`^${crate}\\s*=`, 'm').test(deps), `${crate} would be a way off this Mac that the Privacy page does not list`);
  }
  assert.equal(NOTHING_ELSE, 'Nothing else leaves this Mac.');
});

test('every file Marxy keeps has a row with what it holds, and the families match their own names only', () => {
  const ids = STORED_FILES.map((f) => f.id);
  assert.deepEqual(ids, ['config', 'collection', 'positions', 'history', 'trust', 'workspace', 'layout', 'kinds', 'index', 'versions']);
  const versions = STORED_FILES.find((f) => f.id === 'versions')!;
  const sha = 'a'.repeat(40);
  assert.ok(versions.matches(`versions-${sha}.json`) && versions.matches(`versions-${sha}-01`) && versions.matches(`versions-${sha}-20`));
  assert.ok(!versions.matches('versions.json') && !versions.matches(`versions-${sha}.json.bad-1`));
  const index = STORED_FILES.find((f) => f.id === 'index')!;
  assert.ok(index.matches(`index-${sha}.json`) && !index.matches('index.json'));
  for (const f of STORED_FILES) assert.ok(f.holds.length > 20, f.id);
});

test('storedOnThisMac lists the folders with sizes and opens no file', async () => {
  const calls: string[] = [];
  const entries: Record<string, { path: string; size: number; isDir: boolean; mtimeMs: number }[]> = {
    '/cfg': [
      { path: '/cfg/config.toml', size: 120, isDir: false, mtimeMs: 0 },
      { path: '/cfg/collection.toml', size: 40, isDir: false, mtimeMs: 0 },
    ],
    '/data': [
      { path: '/data/positions.json', size: 2048, isDir: false, mtimeMs: 0 },
      { path: `/data/versions-${'b'.repeat(40)}.json`, size: 300, isDir: false, mtimeMs: 0 },
      { path: `/data/versions-${'b'.repeat(40)}-01`, size: 5000, isDir: false, mtimeMs: 0 },
      { path: '/data/notes.txt', size: 9, isDir: false, mtimeMs: 0 },
    ],
  };
  const shell = {
    configPaths: async () => ({ config: '/cfg/config.toml', data: '/data/' }),
    readDir: async (dir: string) => {
      calls.push(dir);
      return entries[dir] ?? [];
    },
  };
  const out = await storedOnThisMac(shell);
  assert.deepEqual(calls, ['/cfg', '/data']);
  const by = Object.fromEntries(out.map((f) => [f.kind.id, f]));
  assert.equal(by.config!.bytes, 120);
  assert.equal(by.positions!.bytes, 2048);
  assert.equal(by.history!.count, 0);
  assert.equal(by.versions!.count, 2);
  assert.equal(by.versions!.items, 1, 'one file has versions');
  assert.equal(by.versions!.bytes, 5300);
  assert.equal(by.versions!.folder, '/data');
  assert.equal(bytesText(5300), '5.2 KB');
  assert.equal(bytesText(12), '12 B');
});
