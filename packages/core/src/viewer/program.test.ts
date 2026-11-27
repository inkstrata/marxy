import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  builtForWords,
  programKicker,
  programRows,
  readAtBytes,
  readProgram,
  readVersionBlock,
  PROGRAM_CLAIM_SHOWN,
  PROGRAM_READ_MAX,
  PROGRAM_STRING_MAX,
  type ProgramFacts,
  type ReadAt,
} from './program.ts';

// The samples are built by fixtures/programs/make-programs.mjs.
const sample = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/programs/${name}`, import.meta.url)));
const NOW = Date.UTC(2026, 10, 21);

async function facts(bytes: Uint8Array): Promise<ProgramFacts> {
  const r = await readProgram(readAtBytes(bytes), bytes.length, NOW);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.facts;
}
const row = (f: ProgramFacts, label: string): string | undefined => programRows(f).find((r) => r.label === label)?.value;

// Where the samples put things: the PE header at 0x40, the optional header after its 24 bytes.
const OPT = 0x40 + 24;
const STAMP_MS = Date.UTC(2026, 2, 14, 9, 26, 53);
const setU32 = (b: Uint8Array, at: number, n: number): void => new DataView(b.buffer, b.byteOffset).setUint32(at, n, true);

const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const wide = (s: string): number[] => [...s].flatMap((c) => u16(c.charCodeAt(0)));
const pad4 = (a: number[]): number[] => {
  while (a.length % 4) a.push(0);
  return a;
};
/** One VS_VERSIONINFO node. */
const vnode = (key: string, type: number, value: number[], kids: number[][] = []): number[] => {
  const out = pad4([0, 0, ...u16(type === 1 ? value.length / 2 : value.length), ...u16(type), ...wide(key), 0, 0]);
  out.push(...value);
  for (const k of kids) pad4(out).push(...k);
  out[0] = out.length & 0xff;
  out[1] = out.length >> 8;
  return out;
};
const vstr = (key: string, value: string): number[] => vnode(key, 1, [...wide(value), 0, 0]);

const FACTS: ProgramFacts = {
  product: null, version: null, company: null, description: null, machine: 'x64', machineCode: 0x8664, bits: 64, subsystem: 2, library: false,
  anyCpu: false, dotnet: false, built: null, stampNot: null, signature: 'none', hasVersion: true, damaged: null, cut: false,
};

test('a signed installer says its product, version, company and description, and that it is signed, not verified', async () => {
  const f = await facts(sample('tidemark-setup.exe'));
  assert.equal(f.product, 'Tidemark');
  assert.equal(f.version, '2.4.1');
  assert.equal(f.company, 'Tidemark Harbour Works');
  assert.equal(f.description, 'Tide table setup');
  assert.equal(f.signature, 'present');
  assert.equal(row(f, 'signature'), 'Signature present, not verified');
  assert.equal(f.built, Date.UTC(2026, 2, 14, 9, 26, 53));
  assert.equal(programKicker(f), 'A Windows program');
  for (const label of ['product', 'version', 'company', 'description', 'built for', 'built']) {
    assert.match(programRows(f).find((r) => r.label === label)?.note ?? '', /the file’s own claim/, label);
  }
});

test('an unsigned library says it has no signature and no version resource', async () => {
  const f = await facts(sample('plain.dll'));
  assert.equal(f.signature, 'none');
  assert.equal(row(f, 'signature'), 'No signature');
  assert.equal(f.library, true);
  assert.equal(f.hasVersion, false);
  assert.equal(row(f, 'version'), 'none: it carries no version resource');
  assert.equal(programKicker(f), 'A Windows library');
  assert.equal(row(f, 'product'), undefined);
});

test('32-bit, 64-bit and ARM64 samples each name their target, console or window', async () => {
  assert.equal(builtForWords(await facts(sample('tidemark-setup.exe'))), 'x86, 32-bit · a window program');
  assert.equal(builtForWords(await facts(sample('tidemark64.exe'))), 'x64, 64-bit · a console program');
  assert.equal(builtForWords(await facts(sample('tidemark-arm64.exe'))), 'ARM64, 64-bit · a window program');
  assert.equal(builtForWords(await facts(sample('plain.dll'))), 'x64, 64-bit · a library');
});

test('a zero stamp has no build time; a reproducible-build hash is said to be one; a stamp after now is not a time', async () => {
  const zero = await facts(sample('tidemark-arm64.exe'));
  assert.equal(zero.built, null);
  assert.equal(row(zero, 'built'), undefined);
  const repro = await facts(sample('repro.dll'));
  assert.equal(repro.built, null);
  assert.equal(repro.stampNot, 'hash');
  assert.match(row(repro, 'built') ?? '', /reproducible build writes a hash/);
  const early = await readProgram(readAtBytes(sample('tidemark64.exe')), sample('tidemark64.exe').length, Date.UTC(2020, 0, 1));
  assert.ok(early.ok);
  assert.equal(early.facts.built, null);
  assert.equal(early.facts.stampNot, 'later');
});

test('a cyclic or oversized resource directory and a truncated file give a damaged reason, and the header facts stand', async () => {
  const cyclic = await facts(sample('cyclic.exe'));
  assert.equal(cyclic.damaged, 'its resource tree loops back on itself');
  assert.equal(cyclic.product, null);
  assert.match(row(cyclic, 'damaged') ?? '', /^Its resource tree loops back on itself\.$/);
  const oversized = await facts(sample('oversized.exe'));
  assert.match(oversized.damaged ?? '', /directory of 65535 entries, more than its section holds/);
  const truncated = await facts(sample('truncated.exe'));
  assert.match(truncated.damaged ?? '', /shorter than its sections say: the file is cut short/);
  assert.equal(truncated.machine, 'x64');
});

test('bytes that do not begin MZ are not a program; a DOS header alone, or too many sections, is a reason', async () => {
  const text = new TextEncoder().encode('This is a note someone renamed to setup.exe.\n');
  const r = await readProgram(readAtBytes(text), text.length, NOW);
  assert.deepEqual(r, { ok: false, reason: 'Its bytes do not begin MZ, so it is not a Windows program.', notProgram: true });
  const dos = new Uint8Array(128);
  dos.set([0x4d, 0x5a]);
  dos[0x3c] = 0x40;
  const d = await readProgram(readAtBytes(dos), dos.length, NOW);
  assert.ok(!d.ok && !d.notProgram && /an MS-DOS program/.test(d.reason));
  const many = sample('plain.dll').slice();
  const pe = new DataView(many.buffer).getUint32(0x3c, true);
  new DataView(many.buffer).setUint16(pe + 6, 97, true);
  const m = await readProgram(readAtBytes(many), many.length, NOW);
  assert.ok(!m.ok && /names 97 sections, more than the 96/.test(m.reason));
  const empty = await readProgram(readAtBytes(new Uint8Array(0)), 0, NOW);
  assert.ok(!empty.ok && empty.notProgram);
});

test('a version string longer than the cap is cut and the facts say so', () => {
  const node = vnode;
  const long = 'W'.repeat(20_000);
  const block = node('VS_VERSION_INFO', 0, [], [node('StringFileInfo', 1, [], [node('040904B0', 1, [], [vstr('ProductName', long)])])]);
  const s = readVersionBlock(Uint8Array.from(block));
  assert.equal(s.cut, true);
  assert.equal(s.product?.length, PROGRAM_STRING_MAX / 2);
});

// A small seeded generator, so a failure names its seed and repeats.
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

test('hostile input: mutated and cut samples never throw, never hang, never read out of range or past the cap', async () => {
  const names = ['tidemark-setup.exe', 'tidemark64.exe', 'tidemark-arm64.exe', 'plain.dll', 'cyclic.exe', 'oversized.exe', 'repro.dll'];
  const started = Date.now();
  let runs = 0;
  for (const name of names) {
    const base = sample(name);
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed * 7919 + name.length);
      const bytes = base.slice(0, r() < 0.2 ? Math.floor(r() * base.length) : base.length);
      const flips = 1 + Math.floor(r() * 12);
      // Most flips land in the headers and the resource tree, where offsets and counts live.
      for (let i = 0; i < flips && bytes.length > 0; i++) bytes[Math.floor((r() < 0.7 ? r() * Math.min(0x300, bytes.length) : r() * bytes.length))] = Math.floor(r() * 256);
      let read = 0;
      const readAt: ReadAt = async (offset, length) => {
        assert.ok(offset >= 0 && length >= 0 && offset + length <= bytes.length, `seed ${seed} of ${name}: read ${offset}+${length} of ${bytes.length}`);
        read += length;
        return bytes.subarray(offset, offset + length);
      };
      const out = await readProgram(readAt, bytes.length, NOW);
      assert.ok(read <= PROGRAM_READ_MAX);
      if (out.ok) programRows(out.facts);
      else assert.match(out.reason, /\S/);
      runs++;
    }
  }
  assert.equal(runs, names.length * 400);
  assert.ok(Date.now() - started < 30_000, 'the walk is bounded');
});

test('a file that claims a huge size reads no more than the cap, and a read that fails is a reason', async () => {
  const head = sample('plain.dll');
  let read = 0;
  const huge: ReadAt = async (offset, length) => {
    read += length;
    const out = new Uint8Array(length);
    if (offset < head.length) out.set(head.subarray(offset, Math.min(head.length, offset + length)));
    return out;
  };
  const r = await readProgram(huge, 4 * 1024 * 1024 * 1024, NOW);
  assert.ok(r.ok);
  assert.ok(read <= PROGRAM_READ_MAX);
  const failing: ReadAt = async () => {
    throw new Error('gone');
  };
  const f = await readProgram(failing, 1000, NOW);
  assert.ok(!f.ok && /could not be read/.test(f.reason));
});

const NOTEPAD = 'C:\\Windows\\System32\\notepad.exe';
test('a real Windows program, where this machine has one', { skip: !existsSync(NOTEPAD) }, async () => {
  const bytes = new Uint8Array(readFileSync(NOTEPAD));
  const f = await facts(bytes);
  assert.equal(f.company, 'Microsoft Corporation');
  assert.equal(f.description, 'Notepad');
  assert.ok(f.machine === 'x64' || f.machine === 'ARM64');
});

test('a file cut inside its optional header or section table keeps the machine, subsystem and stamp it already said', async () => {
  const whole = sample('tidemark64.exe');
  const inOpt = await facts(whole.slice(0, OPT + 100));
  assert.equal(inOpt.machine, 'x64');
  assert.equal(inOpt.bits, 64);
  assert.equal(inOpt.subsystem, 3);
  assert.equal(inOpt.built, STAMP_MS);
  assert.match(inOpt.damaged ?? '', /cut short inside its optional header/);
  assert.equal(builtForWords(inOpt), 'x64, 64-bit · a console program');
  const early = await facts(whole.slice(0, OPT + 40));
  assert.equal(early.subsystem, null);
  assert.equal(builtForWords(early), 'x64, 64-bit · a kind its cut header does not say');
  assert.equal(early.built, STAMP_MS);
  const inTable = await facts(whole.slice(0, OPT + 240 + 10));
  assert.equal(inTable.subsystem, 3);
  assert.match(inTable.damaged ?? '', /cut short inside its section table/);
  assert.equal(inTable.hasVersion, false);
  assert.equal(inTable.built, STAMP_MS, 'no debug entry, so nothing says the stamp is a hash');
});

test('a stamp whose debug entry cannot be read in a damaged file is not shown as a time', async () => {
  const cut = await facts(sample('repro.dll').slice(0, OPT + 240 + 10));
  assert.ok(cut.damaged);
  assert.equal(cut.built, null);
  assert.equal(row(cut, 'built'), undefined);
});

test('a certificate entry of size 0 is no signature', async () => {
  const b = sample('plain.dll').slice();
  setU32(b, OPT + 112 + 4 * 8, 0x300);
  setU32(b, OPT + 112 + 4 * 8 + 4, 0);
  assert.equal((await facts(b)).signature, 'none');
});

test('a tiny PE whose header overlaps the DOS stub still reads', async () => {
  const plain = sample('plain.dll');
  const b = new Uint8Array(plain.length - 0x3c);
  b.set(plain.subarray(0x40), 4);
  b[0] = 0x4d;
  b[1] = 0x5a;
  setU32(b, 0x3c, 4);
  const f = await facts(b);
  assert.equal(f.machine, 'x64');
  assert.equal(f.library, true);
});

test('zero-width and direction marks are replaced, and a long claim is cut with an ellipsis', () => {
  const block = vnode('VS_VERSION_INFO', 0, [], [vnode('StringFileInfo', 1, [], [vnode('040904B0', 1, [], [vstr('ProductName', 'Tide\u200bmark\u061c\ufeff\u202e'), vstr('FileDescription', 'D'.repeat(300))])])]);
  const s = readVersionBlock(Uint8Array.from(block));
  assert.equal(s.product, 'Tide\ufffdmark\ufffd\ufffd\ufffd');
  const value = row({ ...FACTS, description: s.description }, 'description') ?? '';
  assert.equal(value.length, PROGRAM_CLAIM_SHOWN);
  assert.ok(value.endsWith('\u2026'));
});

test('the string table of the language Translation lists first is the claim, else the first that names one', () => {
  const table = (key: string, version: string): number[] => vnode(key, 1, [], [vstr('ProductName', `Tidemark ${key}`), vstr('ProductVersion', version)]);
  const translation = vnode('VarFileInfo', 1, [], [vnode('Translation', 0, [...u16(0x409), ...u16(0x4b0)])]);
  const listed = readVersionBlock(Uint8Array.from(vnode('VS_VERSION_INFO', 0, [], [vnode('StringFileInfo', 1, [], [table('040704B0', '2.0'), table('040904B0', '2.1')]), translation])));
  assert.equal(listed.product, 'Tidemark 040904B0');
  assert.equal(listed.productVersion, '2.1');
  const unlisted = readVersionBlock(Uint8Array.from(vnode('VS_VERSION_INFO', 0, [], [vnode('StringFileInfo', 1, [], [table('040704B0', '2.0'), table('040904B0', '2.1')])])));
  assert.equal(unlisted.productVersion, '2.0');
});

test('the width comes from the optional header: an x86 machine in a PE32+ file is not called 32-bit', () => {
  assert.equal(builtForWords({ ...FACTS, machine: 'x86', machineCode: 0x14c, bits: 64 }), 'x86, 64-bit · a window program');
  assert.equal(builtForWords({ ...FACTS, machine: 'x86', machineCode: 0x14c, bits: 32 }), 'x86, 32-bit · a window program');
});
