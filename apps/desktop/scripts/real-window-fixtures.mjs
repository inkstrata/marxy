// Bytes and arithmetic for check:tauri's cases on a real disk: encodings with a BOM, a minimal Windows program, a big log, a
// process tree's memory. Pure, so `node --test` covers them without a window.
import { Buffer } from 'node:buffer';

export const utf16LeWithBom = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
export const utf8WithBom = (text) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);

/** Where two byte strings first differ, in words for a failure line; 'identical' when they do not. */
export function describeDifference(actual, expected) {
  if (!actual) return 'the file is not there';
  if (actual.equals(expected)) return 'identical';
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at++;
  const hex = (b) => (at < b.length ? b[at].toString(16).padStart(2, '0') : 'end');
  return `${actual.length} bytes against ${expected.length}; first difference at byte ${at} (${hex(actual)} against ${hex(expected)})`;
}

/**
 * A PE32+ x64 console program with no sections, no resources and no certificate table: the headers and nothing to run.
 * The stamp is a fixed past time so the card has a build time to say.
 */
export function minimalPe() {
  const peAt = 0x40;
  const optional = peAt + 4 + 20;
  const size = 0x200;
  const b = Buffer.alloc(size);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(peAt, 0x3c);
  b.write('PE\0\0', peAt, 'latin1');
  b.writeUInt16LE(0x8664, peAt + 4);
  b.writeUInt16LE(0, peAt + 6);
  b.writeUInt32LE(1700000000, peAt + 8);
  b.writeUInt16LE(240, peAt + 20);
  b.writeUInt16LE(0x0022, peAt + 22);
  b.writeUInt16LE(0x20b, optional);
  b.writeUInt32LE(0x1000, optional + 32);
  b.writeUInt32LE(0x200, optional + 36);
  b.writeUInt32LE(0x2000, optional + 56);
  b.writeUInt32LE(0x200, optional + 60);
  b.writeUInt16LE(3, optional + 68);
  b.writeUInt32LE(16, optional + 108);
  return b;
}

/** Whether a PE file carries a certificate-table entry (data directory 4): the claim the card words as "Signature present". */
export function embeddedSignature(bytes) {
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return false;
  const pe = bytes.readUInt32LE(0x3c);
  if (pe + 24 + 2 > bytes.length || bytes.toString('latin1', pe, pe + 4) !== 'PE\0\0') return false;
  const optional = pe + 24;
  const magic = bytes.readUInt16LE(optional);
  const dirs = optional + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1);
  if (dirs < optional) return false;
  const entry = dirs + 4 * 8;
  return entry + 8 <= bytes.length && bytes.readUInt32LE(entry) !== 0 && bytes.readUInt32LE(entry + 4) !== 0;
}

/** A log of timestamped lines at least `mb` MiB long, the last line saying so; `lines` is how many it has. */
export function largeLog(mb) {
  const parts = [];
  let n = 0;
  for (let i = 0; n < mb * 1024 * 1024; i++) {
    const t = 8 * 3600 + i * 0.37;
    const stamp = `2026-11-19T${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${(t % 60).toFixed(3).padStart(6, '0')}Z`;
    const k = i % 46;
    const line = `${stamp} ${k === 6 ? 'WARN ' : k === 10 ? 'ERROR' : 'INFO '} api: GET /v2/stations/${i} 200 ${1 + (i % 37)} ms`;
    parts.push(line);
    n += line.length + 1;
  }
  parts.push('2026-11-19T23:59:59.999Z INFO  the very last line');
  return { bytes: Buffer.from(`${parts.join('\n')}\n`), lines: parts.length };
}

/** The memory of a process and every descendant of it, from rows of `{ ProcessId, ParentProcessId, WorkingSetSize, PrivatePageCount }`. */
export function treeMemory(rows, rootPid) {
  const all = [].concat(rows ?? []);
  const inTree = new Set([rootPid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of all) {
      if (!inTree.has(r.ProcessId) && inTree.has(r.ParentProcessId)) {
        inTree.add(r.ProcessId);
        grew = true;
      }
    }
  }
  const mine = all.filter((r) => inTree.has(r.ProcessId));
  const mb = (field) => mine.reduce((sum, r) => sum + (Number(r[field]) || 0), 0) / 2 ** 20;
  return { processes: mine.length, workingSetMB: mb('WorkingSetSize'), privateMB: mb('PrivatePageCount') };
}

/** The longest the text may take after the render before a launch counts as having waited for a paint (the fallback is 2000 ms). */
export const LAUNCH_BOUND_MS = 1500;

/**
 * Judges a launch's `MARK painted` line (or undefined when none came): the text on screen within the bound, and a frames-only
 * launch tagged `source=frame`. `fcp_before_ms` is not asked for: the app leaves it off when no earlier paint is on the timeline.
 * Returns `{ ok, via, why }`, where `via` is 'frames-only' or 'engine paint' and `why` names the cause of a failure.
 */
export function launchVerdict(line) {
  if (!line) return { ok: false, via: 'no launch', why: 'no painted mark was printed' };
  const via = /signal=frames-only/.test(line) ? 'frames-only' : 'engine paint';
  const since = Number(/since_render_ms=(\d+)/.exec(line)?.[1] ?? NaN);
  if (!Number.isFinite(since)) return { ok: false, via, why: 'the painted mark has no since_render_ms' };
  if (since >= LAUNCH_BOUND_MS) return { ok: false, via, why: `the text came ${since} ms after the render: the wait for a paint was not cut short` };
  if (via === 'frames-only' && !/source=frame/.test(line)) return { ok: false, via, why: 'a frames-only launch does not say source=frame' };
  return { ok: true, via, why: '' };
}
