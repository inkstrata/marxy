// The clipboard contract (J-02): one set of cases over the memory shell and over the Tauri shell's
// adapter, the latter against a fake of the `pasteboard_*` commands that obeys the rules the Rust
// module tests (J-01.1): one snapshot, concealed refused unread, the 16 MB cap, an allowlisted write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClipboardRep, Shell } from '@marxy/shell-api';
import { clipboard } from './clipboard.ts';
import type { Call } from './clipboard.ts';
import { createMemoryShell } from './memory.ts';

const { CONCEALED, HTML, PNG, RTF, SOURCE, TEXT, TRANSIENT, BUNDLE_ID } = clipboard;
const URL_TYPE = clipboard.URL;
const tauriClipboard = clipboard.tauri;

type ClipShell = Pick<Shell, 'clipboardTypes' | 'clipboardRead' | 'clipboardWriteItem'>;
type Item = Record<string, Uint8Array>;

interface Rig {
  readonly shell: ClipShell;
  set(items: Item[]): void;
  /** Data reads the native side performed, by type. */
  reads(): string[];
  /** Calls that reached the native write. */
  nativeWrites(): number;
  /** The item last written, markers included. */
  written(): Item | null;
  /** Native calls of any kind since construction. */
  nativeCalls(): number;
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const CAP = 16 * 1024 * 1024;

function memoryRig(): Rig {
  const mem = createMemoryShell({});
  return {
    shell: mem,
    set: (items) => mem.setPasteboard(items),
    reads: () => [...mem.pasteboardDataReads],
    nativeWrites: () => mem.pasteboardNativeWrites,
    written: () => mem.lastPasteboardWrite as Item | null,
    nativeCalls: () => mem.calls.length,
  };
}

function tauriRig(): Rig {
  let board: Item[] = [];
  const reads: string[] = [];
  let writes = 0;
  let last: Item | null = null;
  let calls = 0;
  const err = (code: string, message: string) => Object.assign(new Error(message), { code, message });
  const READABLE = [TEXT, HTML, RTF, URL_TYPE, PNG];
  const WRITABLE = [TEXT, HTML, RTF, URL_TYPE];
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
  const call: Call = async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
    calls += 1;
    const concealed = board.some((i) => CONCEALED in i);
    switch (command) {
      case 'pasteboard_types': {
        const types = Object.keys(board[0] ?? {});
        if (!types.includes(CONCEALED) && concealed) types.push(CONCEALED);
        return types as T;
      }
      case 'pasteboard_read': {
        if (concealed) throw err('permission', 'the clipboard holds a concealed item');
        const wanted = args.types as string[];
        const out = { reps: [] as unknown[], skipped: [] as unknown[] };
        for (const type of READABLE) {
          const bytes = board[0]?.[type];
          if (!wanted.includes(type) || !bytes) continue;
          if (bytes.byteLength > CAP) {
            out.skipped.push({ type, len: bytes.byteLength });
            continue;
          }
          reads.push(type);
          out.reps.push(
            type === PNG ? { type, encoding: 'base64', data: b64(bytes) } : { type, encoding: 'utf8', data: text(bytes) },
          );
        }
        return out as T;
      }
      case 'pasteboard_write': {
        const reps = args.reps as { type: string; data: string }[];
        if (reps.length === 0 || reps.some((r) => !WRITABLE.includes(r.type))) throw err('invalid', 'refused');
        writes += 1;
        const item: Item = {};
        for (const r of reps) item[r.type] = utf8(r.data);
        item[SOURCE] = utf8(BUNDLE_ID);
        if (args.transient === true) item[TRANSIENT] = new Uint8Array();
        board = [item];
        last = item;
        return undefined as T;
      }
      default:
        throw err('invalid', `unknown command ${command}`);
    }
  };
  return {
    shell: tauriClipboard(call),
    set: (items) => {
      board = items;
    },
    reads: () => reads,
    nativeWrites: () => writes,
    written: () => last,
    nativeCalls: () => calls,
  };
}

const rigs: readonly (readonly [string, () => Rig])[] = [
  ['memory shell', memoryRig],
  ['tauri adapter over a fake pasteboard', tauriRig],
];

const rejects = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: Error & { code?: string }) => e.code === code);

for (const [name, make] of rigs) {
  test(`${name}: types are listed from the first item and read no data`, async () => {
    const rig = make();
    rig.set([{ [TEXT]: utf8('a'), [HTML]: utf8('<b>a</b>') }, { [RTF]: utf8('x') }]);
    assert.deepEqual(await rig.shell.clipboardTypes(), [TEXT, HTML]);
    assert.deepEqual(rig.reads(), []);
  });

  test(`${name}: a read returns the type asked for, and null for one the item lacks or may not be read`, async () => {
    const rig = make();
    rig.set([{ [TEXT]: utf8('plain'), [HTML]: utf8('<p>h</p>'), 'com.example.private': utf8('secret') }]);
    const got = await rig.shell.clipboardRead(HTML);
    assert.equal(got?.type, HTML);
    assert.equal(text(got?.bytes ?? new Uint8Array()), '<p>h</p>');
    assert.equal(await rig.shell.clipboardRead(RTF), null);
    assert.equal(await rig.shell.clipboardRead('com.example.private'), null);
    assert.deepEqual(rig.reads(), [HTML], 'only the one type asked for was read');
  });

  test(`${name}: PNG bytes survive the trip`, async () => {
    const rig = make();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 1]);
    rig.set([{ [PNG]: png }]);
    assert.deepEqual((await rig.shell.clipboardRead(PNG))?.bytes, png);
  });

  test(`${name}: a concealed item rejects permission and no data is read`, async () => {
    const rig = make();
    rig.set([{ [TEXT]: utf8('hunter2'), [CONCEALED]: new Uint8Array() }]);
    await rejects(rig.shell.clipboardRead(TEXT), 'permission');
    assert.deepEqual(rig.reads(), []);
    assert.ok((await rig.shell.clipboardTypes()).includes(CONCEALED));
    assert.deepEqual(rig.reads(), []);
  });

  test(`${name}: a concealed marker on a later item refuses too`, async () => {
    const rig = make();
    rig.set([{ [TEXT]: utf8('a') }, { [CONCEALED]: new Uint8Array() }]);
    await rejects(rig.shell.clipboardRead(TEXT), 'permission');
    assert.deepEqual(rig.reads(), []);
  });

  test(`${name}: a representation over 16 MB rejects invalid, and is not returned`, async () => {
    const rig = make();
    rig.set([{ [HTML]: new Uint8Array(CAP + 1).fill(97) }]);
    await rejects(rig.shell.clipboardRead(HTML), 'invalid');
  });

  test(`${name}: two representations are one native write and one item, tagged`, async () => {
    const rig = make();
    rig.set([{ [TEXT]: utf8('old') }]);
    const reps: ClipboardRep[] = [
      { type: TEXT, bytes: utf8('hi') },
      { type: HTML, bytes: utf8('<b>hi</b>') },
    ];
    await rig.shell.clipboardWriteItem(reps);
    assert.equal(rig.nativeWrites(), 1);
    const item = rig.written() ?? {};
    assert.deepEqual(Object.keys(item), [TEXT, HTML, SOURCE]);
    assert.equal(text(item[SOURCE] ?? new Uint8Array()), BUNDLE_ID);
    assert.equal(text((await rig.shell.clipboardRead(HTML))?.bytes ?? new Uint8Array()), '<b>hi</b>');
  });

  test(`${name}: transient is marked only when asked`, async () => {
    const rig = make();
    await rig.shell.clipboardWriteItem([{ type: TEXT, bytes: utf8('a') }], { transient: true });
    assert.ok(TRANSIENT in (rig.written() ?? {}));
    await rig.shell.clipboardWriteItem([{ type: TEXT, bytes: utf8('a') }]);
    assert.ok(!(TRANSIENT in (rig.written() ?? {})));
  });

  test(`${name}: a reserved, unlisted, repeated or empty write is rejected before any native call`, async () => {
    const rig = make();
    const t = (type: string): ClipboardRep => ({ type, bytes: utf8('x') });
    for (const reps of [
      [t(TEXT), t(SOURCE)],
      [t(TRANSIENT)],
      [t(CONCEALED)],
      [t(PNG)],
      [t('com.example.private')],
      [t(TEXT), t(TEXT)],
      [],
    ]) {
      await rejects(rig.shell.clipboardWriteItem(reps), 'invalid');
    }
    assert.equal(rig.nativeWrites(), 0);
    assert.equal(rig.nativeCalls(), 0, 'no native call of any kind');
    assert.equal(rig.written(), null);
  });

  test(`${name}: nothing is called, read or written until a method is`, async () => {
    const rig = make();
    rig.set([{ [TEXT]: utf8('a') }]);
    assert.equal(rig.nativeCalls(), 0);
    assert.deepEqual(rig.reads(), []);
  });
}

test('tauri adapter: a native error keeps its code', async () => {
  const shell = tauriClipboard(async () => {
    throw { code: 'unsupported', message: 'the native pasteboard is macOS only' };
  });
  await rejects(shell.clipboardTypes(), 'unsupported');
});

test('tauri adapter: text that is not UTF-8 is refused before the native call', async () => {
  let called = 0;
  const shell = tauriClipboard(async () => {
    called += 1;
    return undefined as never;
  });
  await rejects(shell.clipboardWriteItem([{ type: TEXT, bytes: Uint8Array.from([0xff, 0xfe]) }]), 'invalid');
  assert.equal(called, 0);
});

test('tauri adapter: a write sends the argument shape J-01 expects', async () => {
  const seen: unknown[] = [];
  const shell = tauriClipboard(async (command, args) => {
    seen.push([command, args]);
    return undefined as never;
  });
  await shell.clipboardWriteItem([{ type: TEXT, bytes: utf8('hi') }], { transient: true });
  assert.deepEqual(seen, [['pasteboard_write', { reps: [{ type: TEXT, data: 'hi' }], transient: true }]]);
});

test('the memory shell logs no clipboard call at construction or on harness events', async () => {
  const mem = createMemoryShell({});
  mem.setPasteboard([{ [TEXT]: utf8('a') }]);
  mem.emit([]);
  mem.emitCloseRequested();
  assert.deepEqual(
    mem.calls.filter((c) => c.method.startsWith('clipboard')),
    [],
  );
  assert.deepEqual(mem.pasteboardDataReads, []);
});

test('clipboardWrite is unchanged: one recorded call with its argument', async () => {
  const mem = createMemoryShell({});
  await mem.clipboardWrite({ text: 'a', html: '<i>a</i>' });
  assert.deepEqual(mem.calls, [{ method: 'clipboardWrite', args: [{ text: 'a', html: '<i>a</i>' }] }]);
  assert.equal(mem.pasteboardNativeWrites, 0, 'the old write does not touch the new pasteboard');
});
