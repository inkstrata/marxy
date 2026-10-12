// The trust controller's load failure: told once, retried on a grant, never trusting what is not on disk (F-13).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { NoticeInput } from '../notices/index.ts';
import { TRUST_UNREADABLE_TEXT } from '../notices/trust-copy.ts';
import { createTrustController } from './controller.ts';

// grantSummaryNotice raises its line through the page's notice region; a throwaway DOM keeps it in Node.
function fakeElement(): any {
  const own: Record<string, unknown> = { dataset: {}, style: {}, children: [], parentElement: null };
  return new Proxy(own, {
    get: (t, k) => (k in t ? t[k as string] : () => fakeElement()),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
}
(globalThis as any).window = globalThis;
(globalThis as any).HTMLElement = class {}; // a revoke dismisses the grant's "Showing HTML" line
(globalThis as any).document = {
  getElementById: () => fakeElement(),
  querySelector: () => null,
  createElement: () => fakeElement(),
  createElementNS: () => fakeElement(), // a notice's glyph is an SVG element (U-02)
  body: fakeElement(),
};

const DOC = '/docs/a.md';
const trustPath = '/data/trust.json';

function rig(readFile: (p: string) => Promise<Uint8Array>) {
  const writes: Uint8Array[] = [];
  const notices: NoticeInput[] = [];
  let renders = 0;
  const controller = createTrustController({
    shell: {
      readFile,
      writeFileAtomic: async (_p: string, b: Uint8Array) => { writes.push(b); },
      configPaths: async () => ({ config: '/config', data: '/data' }) as never,
    },
    currentPath: () => DOC,
    buffer: () => ({ bytes: new Uint8Array(0) }) as never,
    position: () => ({ byteOffset: 0, fraction: 0 }),
    rerender: () => { renders += 1; },
    showSource: async () => {},
    notify: (n) => { notices.push(n); },
  });
  return { controller, writes, notices, renders: () => renders };
}

const err = (code: string) => Object.assign(new Error(code), { code });
const onDisk = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj));

test('a failed read (io) shows the notice once and trusts nothing', async () => {
  const { controller, notices, writes } = rig(async () => { throw err('io'); });
  await controller.load();
  await controller.load();
  assert.equal(notices.filter((n) => n.text === TRUST_UNREADABLE_TEXT).length, 1);
  assert.equal(controller.grantsFor(DOC).html, false);
  assert.equal(writes.length, 0);
});

test('a missing file (not-found) shows no notice and a grant works', async () => {
  const { controller, notices, writes } = rig(async () => { throw err('not-found'); });
  await controller.load();
  assert.equal(notices.length, 0);
  await controller.grantHtml();
  assert.equal(writes.length, 1);
  assert.equal(controller.grantsFor(DOC).html, true);
});

test('a grant after a transient failure retries the load, keeps earlier grants, and persists', async () => {
  let reads = 0;
  const existing = { version: 1, documents: { '/other.md': { html: true, at: 5 } } };
  const { controller, writes, renders } = rig(async (p) => {
    assert.equal(p, trustPath);
    if (++reads === 1) throw err('io');
    return onDisk(existing);
  });
  await controller.load();
  await controller.grantHtml();
  assert.equal(reads, 2);
  assert.equal(writes.length, 1);
  const saved = JSON.parse(new TextDecoder().decode(writes[0]));
  assert.equal(saved.documents['/other.md'].html, true);
  assert.equal(saved.documents[DOC].html, true);
  assert.equal(renders(), 1);
});

test('a grant after a second failure writes nothing and tells the reader again', async () => {
  const { controller, writes, notices, renders } = rig(async () => { throw err('io'); });
  await controller.load();
  await controller.grantHtml();
  assert.equal(writes.length, 0);
  assert.equal(renders(), 0);
  assert.equal(controller.grantsFor(DOC).html, false);
  assert.equal(notices.filter((n) => n.text === TRUST_UNREADABLE_TEXT).length, 2);
});

test('a grant made while the first read is still in flight waits for it and is kept (F-64)', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { controller, writes, renders } = rig(async () => { await gate; throw err('not-found'); });
  const loading = controller.load();
  const granted = controller.grantHtml();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(writes.length, 0, 'nothing written before the read settles');
  release();
  await loading;
  await granted;
  assert.equal(writes.length, 1);
  assert.equal(controller.grantsFor(DOC).html, true);
  assert.equal(renders(), 1);
});

test('a grant with no read started yet starts it, waits, and tells a failure once (F-64)', async () => {
  const { controller, writes, notices } = rig(async () => { throw err('io'); });
  await controller.grantHtml();
  assert.equal(writes.length, 0);
  assert.equal(notices.filter((n) => n.text === TRUST_UNREADABLE_TEXT).length, 1);
});

// A rig with a disk behind it and a document the test moves: the tests below read trust.json back.
function diskRig(opts: { failReads: number; failWith?: string; failWrites?: boolean }) {
  let disk: Uint8Array | null = onDisk({ version: 1, documents: { '/other.md': { html: true, at: 5 } } });
  let reads = 0;
  let writeCalls = 0;
  let path = '/docs/a.md';
  const notices: NoticeInput[] = [];
  let renders = 0;
  const controller = createTrustController({
    shell: {
      readFile: async (p: string) => {
        assert.equal(p, trustPath);
        if (++reads <= opts.failReads) throw err(opts.failWith ?? 'io');
        return disk!;
      },
      writeFileAtomic: async (_p: string, b: Uint8Array) => {
        writeCalls += 1;
        if (opts.failWrites) throw err('io');
        disk = b;
      },
      configPaths: async () => ({ config: '/config', data: '/data' }) as never,
    },
    currentPath: () => path,
    buffer: () => ({ bytes: new Uint8Array(0) }) as never,
    position: () => ({ byteOffset: 0, fraction: 0 }),
    rerender: () => { renders += 1; },
    showSource: async () => {},
    notify: (n) => { notices.push(n); },
  });
  const saved = () => JSON.parse(new TextDecoder().decode(disk!)).documents as Record<string, { html: boolean }>;
  const on = (p: string) => { path = p; };
  return { controller, saved, on, notices, reads: () => reads, writes: () => writeCalls, renders: () => renders };
}

test('two grants on different documents during a failed-then-retried read both reach trust.json (F-64.1)', async () => {
  const r = diskRig({ failReads: 1 });
  await r.controller.load(); // the first read fails and the reader is told
  r.on('/A.md');
  const a = r.controller.grantHtml();
  r.on('/B.md');
  const b = r.controller.grantHtml();
  await Promise.all([a, b]);
  assert.equal(r.reads(), 2, 'one read for the failure and one retry, however many clicks waited on it');
  assert.equal(r.controller.grantsFor('/A.md').html, true);
  assert.equal(r.controller.grantsFor('/B.md').html, true);
  const saved = r.saved();
  assert.equal(saved['/A.md']?.html, true, 'a grant the reader was told succeeded is in the file');
  assert.equal(saved['/B.md']?.html, true);
  assert.equal(saved['/other.md']?.html, true, 'grants already in the file are kept');
  assert.equal(r.notices.filter((n) => n.text === TRUST_UNREADABLE_TEXT).length, 1);
});

test('a grant on A then a revoke on B during a failed-then-retried read leave the right state (F-64.1)', async () => {
  const r = diskRig({ failReads: 1 });
  await r.controller.load();
  r.on('/A.md');
  const grant = r.controller.grantHtml();
  r.on('/other.md');
  const revoke = r.controller.revokeHtml();
  await Promise.all([grant, revoke]);
  assert.equal(r.reads(), 2);
  assert.equal(r.controller.grantsFor('/A.md').html, true);
  assert.equal(r.controller.grantsFor('/other.md').html, false);
  const saved = r.saved();
  assert.equal(saved['/A.md']?.html, true);
  assert.equal(saved['/other.md'], undefined, 'the revoke is applied, not lost to the retry');
});

test('a read that keeps failing writes nothing, tells the reader, and applies no grant (F-64.1)', async () => {
  const r = diskRig({ failReads: 99 });
  await r.controller.load();
  r.on('/A.md');
  const a = r.controller.grantHtml();
  r.on('/B.md');
  const b = r.controller.grantHtml();
  await Promise.all([a, b]);
  assert.equal(r.reads(), 2, 'one retry shared by both clicks');
  assert.equal(r.writes(), 0);
  assert.equal(r.renders(), 0);
  assert.equal(r.controller.grantsFor('/A.md').html, false);
  assert.equal(r.controller.grantsFor('/B.md').html, false);
  assert.equal(r.notices.filter((n) => n.text === TRUST_UNREADABLE_TEXT).length, 2, 'the failed read and the failed retry');
});

test('a grant whose write fails tells the reader and does not stay granted (F-64.1)', async () => {
  const r = diskRig({ failReads: 1, failWrites: true });
  await r.controller.load();
  r.on('/A.md');
  await r.controller.grantHtml();
  assert.equal(r.controller.grantsFor('/A.md').html, false);
  assert.equal(r.renders(), 0);
  assert.equal(r.notices.filter((n) => n.kind === 'error' && n.text !== TRUST_UNREADABLE_TEXT).length, 1);
});
