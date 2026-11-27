import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hotkeyWords, isShellLink, readShortcut, shortcutRows, showWords, SHORTCUT_STRING_MAX, type ShortcutFacts } from './shortcut.ts';

const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const wide = (s: string): number[] => [...s].flatMap((c) => u16(c.charCodeAt(0)));
const ansi = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const CLSID = [0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46];
// 2026-01-01 00:00:00 UTC as a FILETIME.
const T2026 = (BigInt(Date.UTC(2026, 0, 1)) + 11644473600000n) * 10000n;
const ft = (t: bigint): number[] => [...u32(Number(t & 0xffffffffn)), ...u32(Number(t >> 32n))];

interface Spec {
  flags?: number;
  attrs?: number;
  size?: number;
  show?: number;
  hotkey?: number;
  icon?: number;
  list?: number[];
  info?: number[];
  strings?: number[][];
  extra?: number[];
}

function lnk(o: Spec = {}): Uint8Array {
  const head = [
    ...u32(0x4c), ...CLSID, ...u32(o.flags ?? 0), ...u32(o.attrs ?? 0x20), ...ft(T2026), ...ft(T2026 + 10_000_000n), ...ft(0n),
    ...u32(o.size ?? 0), ...u32(o.icon ?? 0), ...u32(o.show ?? 1), ...u16(o.hotkey ?? 0), ...u16(0), ...u32(0), ...u32(0),
  ];
  return Uint8Array.from([...head, ...(o.list ?? []), ...(o.info ?? []), ...(o.strings ?? []).flat(), ...(o.extra ?? []), ...u32(0)]);
}

/** A LinkInfo with a local base path and a common suffix, ANSI. */
function linkInfo(base: string, suffix: string): number[] {
  const header = 0x1c;
  const vol = [...u32(0x10), ...u32(3), ...u32(0x12345678), ...u32(0x10), ...ansi('OS'), 0];
  const baseAt = header + vol.length;
  const suffixAt = baseAt + base.length + 1;
  const size = suffixAt + suffix.length + 1;
  return [...u32(size), ...u32(header), ...u32(1), ...u32(header), ...u32(baseAt), ...u32(0), ...u32(suffixAt), ...vol, ...ansi(base), 0, ...ansi(suffix), 0];
}

const text = (s: string, unicode = true): number[] => [...u16(s.length), ...(unicode ? wide(s) : ansi(s))];

// A drive item and two file items, each with the short name only.
function itemList(...names: string[]): number[] {
  const item = (data: number[]): number[] => [...u16(data.length + 2), ...data];
  const items = [
    item([0x1f, 0x50, 0xe0, 0x4f, 0xd0, 0x20, 0xea, 0x3a, 0x69, 0x10, 0xa2, 0xd8, 0x08, 0x00, 0x2b, 0x30, 0x30, 0x9d]),
    item([0x2f, ...ansi('C:\\'), ...new Array(18).fill(0)]),
    ...names.map((n) => item([0x32, 0, ...u32(10), ...u16(0), ...u16(0), ...u16(0x20), ...ansi(n), 0, 0])),
  ].flat();
  return [...u16(items.length + 2), ...items, ...u16(0)];
}

const facts = (bytes: Uint8Array): ShortcutFacts => {
  const r = readShortcut(bytes);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.facts;
};

test('the header is told by its size and class id', () => {
  assert.equal(isShellLink(lnk()), true);
  assert.equal(isShellLink(lnk().subarray(0, 19)), false);
  const wrong = lnk();
  wrong[5] = 0;
  assert.equal(isShellLink(wrong), false);
});

test('a target from the link info joins its base path and suffix', () => {
  const f = facts(lnk({ flags: 0x2 | 0x4 | 0x10 | 0x20 | 0x80, info: linkInfo('C:\\Windows\\', 'notepad.exe'), strings: [text('Edits text'), text('C:\\Windows'), text('-x "a b"')] }));
  assert.equal(f.target, 'C:\\Windows\\notepad.exe');
  assert.equal(f.targetFrom, 'local');
  assert.equal(f.description, 'Edits text');
  assert.equal(f.workingDir, 'C:\\Windows');
  assert.equal(f.arguments, '-x "a b"');
});

test('string data follow the flags in the order the format fixes', () => {
  const f = facts(
    lnk({
      flags: 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80,
      strings: [text('desc'), text('..\\tool.exe'), text('C:\\work'), text('--flag'), text('%windir%\\x.dll')],
      show: 7,
      hotkey: 0x0646,
      icon: 3,
      size: 2048,
    }),
  );
  assert.deepEqual([f.description, f.relative, f.workingDir, f.arguments, f.icon], ['desc', '..\\tool.exe', 'C:\\work', '--flag', { path: '%windir%\\x.dll', index: 3 }]);
  assert.equal(f.showCommand, 7);
  assert.equal(f.hotkey, 'Ctrl + Alt + F');
  assert.equal(f.targetSize, 2048);
  assert.equal(f.created, Date.UTC(2026, 0, 1));
  assert.equal(f.accessed, Date.UTC(2026, 0, 1) + 1000);
  assert.equal(f.modified, null);
  assert.equal(f.target, null);
});

test('ANSI string data are read as bytes', () => {
  assert.equal(facts(lnk({ flags: 0x20, strings: [text('/s', false)] })).arguments, '/s');
});

test('with no link info, the item list names the target, best effort', () => {
  const f = facts(lnk({ flags: 0x1, list: itemList('Tools', 'run.exe') }));
  assert.equal(f.target, 'C:\\Tools\\run.exe');
  assert.equal(f.targetFrom, 'items');
});

test('an item list of a special folder names no path', () => {
  const guid = [0x1f, 0x50, ...new Array(16).fill(7)];
  const items = [...u16(guid.length + 2), ...guid];
  const f = facts(lnk({ flags: 0x1, list: [...u16(items.length + 2), ...items, ...u16(0)] }));
  assert.equal(f.target, null);
  assert.match(shortcutRows(f)[0]!.value, /nothing a path can name/);
});

test('an environment block gives the target with its variables', () => {
  const block = new Array(0x314).fill(0);
  block.splice(0, 8, ...u32(0x314), ...u32(0xa0000001));
  const w = wide('%windir%\\regedit.exe');
  block.splice(268, w.length, ...w);
  const f = facts(lnk({ extra: block }));
  assert.equal(f.withVariables, '%windir%\\regedit.exe');
  assert.equal(shortcutRows(f)[0]!.label, 'points at');
});

test('a folder target says so, and zero times are not written', () => {
  const rows = shortcutRows(facts(lnk({ attrs: 0x10 })));
  assert.ok(rows.some((r) => r.label === 'target size' && r.value === 'a folder'));
  assert.ok(!rows.some((r) => r.label === 'target edited'));
});

test('words for the show command and the hotkey', () => {
  assert.match(showWords(7), /minimised/);
  assert.match(showWords(0), /stored as 0/);
  assert.equal(hotkeyWords(0), null);
  assert.equal(hotkeyWords(0x0170), 'Shift + F1');
  assert.equal(hotkeyWords(0x0241), 'Ctrl + A');
});

test('a string over the cap is cut and the facts say so', () => {
  const long = 'a'.repeat(SHORTCUT_STRING_MAX + 100);
  const f = facts(lnk({ flags: 0x20, strings: [text(long, false)] }));
  assert.equal(f.arguments?.length, SHORTCUT_STRING_MAX);
  assert.equal(f.cut, true);
});

test('controls and bidirectional overrides in a string are replaced', () => {
  const f = facts(lnk({ flags: 0x20 | 0x80, strings: [text('a\u202Eb\u0007c')] }));
  assert.equal(f.arguments, 'a\ufffdb\ufffdc');
});

test('damaged input gives a reason and never throws', () => {
  const cases: Uint8Array[] = [
    new Uint8Array(),
    new Uint8Array(40),
    lnk().subarray(0, 60),
    lnk({ flags: 0x1 }).subarray(0, 76),
    Uint8Array.from([...lnk({ flags: 0x1 }).subarray(0, 76), ...u16(0xffff)]),
    Uint8Array.from([...lnk({ flags: 0x2 }).subarray(0, 76), ...u32(0xffffffff), ...new Array(30).fill(0)]),
    Uint8Array.from([...lnk({ flags: 0x20 }).subarray(0, 76), ...u16(5000)]),
    Uint8Array.from([...lnk({ flags: 0x20 | 0x80 }).subarray(0, 76), ...u16(0xffff), 1, 2]),
  ];
  for (const bytes of cases) {
    const r = readShortcut(bytes);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /^The shortcut is damaged: /);
  }
});

test('link info offsets that point outside it do not read outside it', () => {
  const info = linkInfo('C:\\a', 'b');
  info.splice(16, 4, ...u32(0x7fffffff));
  const r = readShortcut(lnk({ flags: 0x2, info }));
  assert.equal(r.ok, true);
});

test('random bytes after a valid header never throw', () => {
  let seed = 12345;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  for (let n = 0; n < 400; n++) {
    const bytes = lnk({ flags: rnd() | (rnd() << 8) });
    const body = Uint8Array.from({ length: rnd() }, rnd);
    const joined = Uint8Array.from([...bytes.subarray(0, 76), ...body]);
    assert.doesNotThrow(() => readShortcut(joined));
  }
});

test('a real shortcut of this repository reads', () => {
  const real = new Uint8Array(readFileSync(new URL('../../../../fixtures/demo/shortcuts/Registry Editor.lnk', import.meta.url)));
  const f = facts(real);
  assert.equal(f.withVariables, '%windir%\\regedit.exe');
  assert.equal(f.workingDir, '%windir%');
  assert.deepEqual(f.icon, { path: '%windir%\\regedit.exe', index: -100 });
});
