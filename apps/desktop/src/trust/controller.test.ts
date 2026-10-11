// The trust controller's load failure: told once, retried on a grant, never trusting what is not on disk (F-13).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { NoticeInput } from '../notices/index.ts';
import { TRUST_UNREADABLE_TEXT } from '../notices/trust-copy.ts';
import { createTrustController } from './controller.ts';

// grantSummaryNotice raises its line through the page's notice region; a throwaway DOM keeps it in Node.
function fakeElement(): any {
  const own: Record<string, unknown> = { dataset: {}, style: {}, children: [] };
  return new Proxy(own, {
    get: (t, k) => (k in t ? t[k as string] : () => fakeElement()),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
}
(globalThis as any).window = globalThis;
(globalThis as any).document = {
  getElementById: () => fakeElement(),
  querySelector: () => null,
  createElement: () => fakeElement(),
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
