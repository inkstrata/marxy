// Builds the tiny PE samples beside this script: headers, one resource section and, where asked, a version resource,
// a debug entry or a certificate-table entry. None of them holds code that would run. `node fixtures/programs/make-programs.mjs`
import { writeFileSync } from 'node:fs';

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const wide = (s) => [...s].flatMap((c) => u16(c.charCodeAt(0)));
const pad4 = (a) => {
  while (a.length % 4) a.push(0);
  return a;
};

/** One VS_VERSIONINFO node: length, value length, type, key, padding, value, padding, children. */
function vnode(key, { value = [], type = 1, valueLen, children = [] } = {}) {
  const out = [0, 0, ...u16(valueLen ?? (type === 1 ? value.length / 2 : value.length)), ...u16(type), ...wide(key), 0, 0];
  pad4(out);
  out.push(...value);
  for (const c of children) {
    pad4(out);
    out.push(...c);
  }
  out[0] = out.length & 0xff;
  out[1] = out.length >> 8;
  return out;
}

function versionInfo(strings, [a, b, c, d]) {
  const fixed = [
    ...u32(0xfeef04bd), ...u32(0x10000), ...u32((a << 16) | b), ...u32((c << 16) | d), ...u32((a << 16) | b), ...u32((c << 16) | d),
    ...u32(0x3f), ...u32(0), ...u32(0x40004), ...u32(1), ...u32(0), ...u32(0), ...u32(0),
  ];
  const table = vnode('040904B0', { children: Object.entries(strings).map(([k, v]) => vnode(k, { value: [...wide(v), 0, 0] })) });
  const sfi = vnode('StringFileInfo', { children: [table] });
  const vfi = vnode('VarFileInfo', { children: [vnode('Translation', { type: 0, value: [...u16(0x409), ...u16(0x4b0)] })] });
  return vnode('VS_VERSION_INFO', { type: 0, value: fixed, children: [sfi, vfi] });
}

const RSRC_VA = 0x1000;
const RSRC_RAW = 0x200;

/** The resource section: type 16, name 1, language 0x409, the data entry and the block; `tree` bends it for the hostile samples. */
function resources(version, tree = 'good') {
  const dir = (ids) => [...u32(0), ...u32(0), ...u16(0), ...u16(0), ...u16(0), ...u16(ids.length), ...ids.flatMap(([id, to]) => [...u32(id), ...u32(to)])];
  const sub = (at) => (0x80000000 | at) >>> 0;
  const out = [];
  if (tree === 'oversized') {
    // A root directory claiming 65,535 entries in a section of a few hundred bytes.
    out.push(...u32(0), ...u32(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0xffff), ...u32(16), ...u32(sub(0x18)));
  } else {
    out.push(...dir([[16, sub(0x18)]]));
  }
  // The name level of the cyclic sample points back at the root.
  out.push(...dir([[1, tree === 'cyclic' ? sub(0) : sub(0x30)]]));
  out.push(...dir([[0x409, 0x48]]));
  out.push(...u32(RSRC_VA + 0x60), ...u32(version.length), ...u32(0), ...u32(0));
  while (out.length < 0x60) out.push(0);
  out.push(...version);
  return pad4(out);
}

/**
 * A PE file. `machine` 0x14c, 0x8664 or 0xaa64; `plus` for PE32+; `version` the block or null; `signed` appends a
 * certificate-table entry; `repro` adds a debug entry saying the stamp is a hash.
 */
function pe({ machine, plus, subsystem = 2, dll = false, stamp = 0, version = null, tree = 'good', signed = false, repro = false }) {
  let rsrc = version ? resources(version, tree) : [0, 0, 0, 0];
  const debugAt = rsrc.length;
  if (repro) rsrc = [...rsrc, ...u32(0), ...u32(0), ...u16(0), ...u16(0), ...u32(16), ...u32(0), ...u32(0), ...u32(0)];
  const rawSize = (rsrc.length + 0x1ff) & ~0x1ff;
  const body = [...rsrc, ...new Array(rawSize - rsrc.length).fill(0)];
  const fileEnd = RSRC_RAW + rawSize;
  const cert = signed ? [...u32(16), ...u16(0x200), ...u16(2), 0x30, 0x82, 0, 0, 0, 0, 0, 0] : [];
  const dirs = new Array(16).fill(null).map(() => [0, 0]);
  if (version) dirs[2] = [RSRC_VA, rsrc.length];
  if (signed) dirs[4] = [fileEnd, cert.length];
  if (repro) dirs[6] = [RSRC_VA + debugAt, 28];
  const optSize = plus ? 240 : 224;
  const opt = [
    ...u16(plus ? 0x20b : 0x10b), 14, 0, ...u32(0), ...u32(rawSize), ...u32(0), ...u32(0), ...u32(RSRC_VA),
    ...(plus ? [...u32(0x40000000), ...u32(1)] : [...u32(0), ...u32(0x400000)]),
    ...u32(0x1000), ...u32(0x200), ...u16(6), ...u16(0), ...u16(0), ...u16(0), ...u16(6), ...u16(0), ...u32(0),
    ...u32(0x2000), ...u32(0x200), ...u32(0), ...u16(subsystem), ...u16(0x8160),
    ...(plus ? [...u32(0x100000), ...u32(0), ...u32(0x1000), ...u32(0), ...u32(0x100000), ...u32(0), ...u32(0x1000), ...u32(0)] : [...u32(0x100000), ...u32(0x1000), ...u32(0x100000), ...u32(0x1000)]),
    ...u32(0), ...u32(16), ...dirs.flatMap(([a, s]) => [...u32(a), ...u32(s)]),
  ];
  if (opt.length !== optSize) throw new Error(`optional header is ${opt.length}`);
  const section = [...[...'.rsrc'].map((c) => c.charCodeAt(0)), 0, 0, 0, ...u32(rsrc.length), ...u32(RSRC_VA), ...u32(rawSize), ...u32(RSRC_RAW), ...u32(0), ...u32(0), ...u16(0), ...u16(0), ...u32(0x40000040)];
  const head = [0x4d, 0x5a, ...new Array(0x3a).fill(0), ...u32(0x40), ...[...'PE'].map((c) => c.charCodeAt(0)), 0, 0];
  head.push(...u16(machine), ...u16(1), ...u32(stamp), ...u32(0), ...u32(0), ...u16(optSize), ...u16(0x0102 | (dll ? 0x2000 : 0)), ...opt, ...section);
  while (head.length < RSRC_RAW) head.push(0);
  return Uint8Array.from([...head, ...body, ...cert]);
}

const STRINGS = { CompanyName: 'Tidemark Harbour Works', FileDescription: 'Tide table setup', ProductName: 'Tidemark', ProductVersion: '2.4.1', FileVersion: '2.4.1.7' };
// 2026-03-14 09:26:53 UTC.
const STAMP = Math.floor(Date.UTC(2026, 2, 14, 9, 26, 53) / 1000);
const here = (name) => new URL(name, import.meta.url);

const samples = {
  'tidemark-setup.exe': pe({ machine: 0x14c, plus: false, stamp: STAMP, version: versionInfo(STRINGS, [2, 4, 1, 7]), signed: true }),
  'tidemark64.exe': pe({ machine: 0x8664, plus: true, subsystem: 3, stamp: STAMP, version: versionInfo({ ...STRINGS, FileDescription: 'Tide table tool' }, [2, 4, 1, 7]) }),
  'tidemark-arm64.exe': pe({ machine: 0xaa64, plus: true, stamp: 0, version: versionInfo({ ...STRINGS, FileDescription: 'Tide tables for ARM' }, [2, 4, 1, 7]), repro: true }),
  'plain.dll': pe({ machine: 0x8664, plus: true, dll: true, stamp: STAMP }),
  'cyclic.exe': pe({ machine: 0x8664, plus: true, version: versionInfo(STRINGS, [1, 0, 0, 0]), tree: 'cyclic' }),
  'oversized.exe': pe({ machine: 0x8664, plus: true, version: versionInfo(STRINGS, [1, 0, 0, 0]), tree: 'oversized' }),
};
// Cut inside its resource section: the headers stand, the version block does not.
samples['truncated.exe'] = samples['tidemark64.exe'].subarray(0, RSRC_RAW + 0x50);
// A reproducible build: the header's stamp is a hash, and a debug entry says so.
samples['repro.dll'] = pe({ machine: 0x8664, plus: true, dll: true, stamp: 0x9e3779b9, repro: true });

for (const [name, bytes] of Object.entries(samples)) writeFileSync(here(name), bytes);
console.log(Object.entries(samples).map(([n, b]) => `${n} ${b.length}`).join('\n'));
