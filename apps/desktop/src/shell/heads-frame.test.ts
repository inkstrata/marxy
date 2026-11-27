// read_archive_heads' raw body, unframed: the same bytes commands/archive.rs's frame test builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headsFrame } from './tauri.ts';
import { clipboard } from './clipboard.ts';

const enc = (s: string): Uint8Array => clipboard.utf8(s);

function frame(json: string, bytes: Uint8Array): Uint8Array {
  const head = enc(json);
  const out = new Uint8Array(4 + head.length + bytes.length);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  out.set(bytes, 4 + head.length);
  return out;
}

test('the heads frame unframes into each head with its own bytes, in order', () => {
  const json =
    '[{"index":3,"length":3,"whole":true,"refused":null},{"index":0,"length":0,"whole":false,"refused":"A folder has nothing to open."},{"index":7,"length":4,"whole":false,"refused":null}]';
  const heads = headsFrame(frame(json, Uint8Array.of(0x61, 0x62, 0x63, 0x00, 0xff, 0x64, 0x65)));
  assert.deepEqual(heads, [
    { index: 3, bytes: Uint8Array.of(0x61, 0x62, 0x63), whole: true, refused: null },
    { index: 0, bytes: new Uint8Array(0), whole: false, refused: 'A folder has nothing to open.' },
    { index: 7, bytes: Uint8Array.of(0x00, 0xff, 0x64, 0x65), whole: false, refused: null },
  ]);
  assert.deepEqual(headsFrame(enc('\x02\x00\x00\x00[]')), []);
});

test('a frame read from the middle of a larger buffer still finds its own bytes', () => {
  const inner = frame('[{"index":1,"length":2,"whole":true,"refused":null}]', Uint8Array.of(9, 8));
  const outer = new Uint8Array(inner.length + 5);
  outer.set(inner, 5);
  const [head] = headsFrame(outer.subarray(5));
  assert.deepEqual([...head!.bytes], [9, 8]);
});
