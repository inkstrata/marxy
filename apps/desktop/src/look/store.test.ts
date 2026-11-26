// look.toml and the reader's own looks: a file that is there but cannot be read (or a look file that does not parse) is
// never written over with the defaults. Node only; the store is module state, so the tests run in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flushLooks, loadLooks, lookState, setLookState } from './store.ts';

const enc = new TextEncoder();

function fakeShell(files: Record<string, string | Error>) {
  const writes: string[] = [];
  const said: string[] = [];
  const shell = {
    configPaths: async () => ({ config: '/cfg/config.toml', data: '/data' }),
    readDir: async (dir: string) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`))
        .map((path) => ({ path, isDir: false, size: 1, mtimeMs: 0 })),
    readFile: async (path: string) => {
      const f = files[path];
      if (f === undefined) throw Object.assign(new Error(`${path}: not found`), { code: 'not-found' });
      if (f instanceof Error) throw f;
      return enc.encode(f);
    },
    writeFileAtomic: async (path: string, bytes: Uint8Array) => {
      writes.push(path);
      files[path] = new TextDecoder().decode(bytes);
    },
  };
  return { shell, writes, said, say: (n: { text: string }) => said.push(n.text) };
}

const locked = () => Object.assign(new Error('/cfg/look.toml: used by another process (os error 32)'), { code: 'io' });

test('a look.toml that cannot be read is not written over, and that is said once', async () => {
  const f = fakeShell({ '/cfg/look.toml': locked() });
  await loadLooks(f.shell as never, f.say);
  setLookState(lookState());
  await flushLooks();
  assert.deepEqual(f.writes, []);
  assert.equal(f.said.length, 1, JSON.stringify(f.said));
  assert.match(f.said[0]!, /look\.toml could not be read · .*another process/);
});

test('a look.toml that names an own look whose file does not parse is not written over', async () => {
  const text = 'on = true\nlook = "mine-night"\n\n[tweaks.mine-night]\nsize = 19\n';
  const f = fakeShell({ '/cfg/look.toml': text, '/cfg/looks/mine-night.look.toml': 'name = "Mine at night\n' });
  await loadLooks(f.shell as never, f.say);
  setLookState(lookState());
  await flushLooks();
  assert.deepEqual(f.writes, []);
  assert.equal(f.said.length, 1, JSON.stringify(f.said));
  assert.match(f.said[0]!, /mine-night\.look\.toml could not be read/);
});

test('a missing look.toml is a new state and is written; a broken look file it does not name stops nothing', async () => {
  const f = fakeShell({ '/cfg/looks/other.look.toml': 'name = "broken\n' });
  await loadLooks(f.shell as never, f.say);
  setLookState(lookState());
  await flushLooks();
  assert.deepEqual(f.writes, ['/cfg/look.toml']);
  assert.deepEqual(f.said, []);
});
