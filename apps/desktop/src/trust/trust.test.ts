// trust.json store: LRU, v0.1.0 files with image hosts, corrupt quarantine (MARXY-44).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  TRUST_LRU_CAP,
  createTrustStore,
  loadTrust,
  emptyTrustEnvelope,
  parseTrustFile,
  quarantinePathFor,
  serializeTrustFile,
} from './trust.ts';

test('LRU cap evicts the oldest document path from what is written', async () => {
  const realNow = Date.now;
  let clock = 1_000;
  Date.now = () => clock++;
  try {
    const writes: Uint8Array[] = [];
    const store = createTrustStore(emptyTrustEnvelope(), async (b) => { writes.push(b); });
    for (let i = 0; i < TRUST_LRU_CAP + 3; i++) {
      await store.grant(`/f${i}.md`, { html: true });
    }
    const last = JSON.parse(new TextDecoder().decode(writes[writes.length - 1]));
    assert.equal(Object.keys(last.documents).length, TRUST_LRU_CAP);
    assert.ok(!last.documents['/f0.md']);
    assert.ok(!last.documents['/f1.md']);
    assert.ok(!last.documents['/f2.md']);
    assert.ok(last.documents['/f3.md']);
    assert.ok(last.documents[`/f${TRUST_LRU_CAP + 2}.md`]);
  } finally {
    Date.now = realNow;
  }
});

const V1_WITH_HOSTS = `${JSON.stringify({
  version: 1,
  documents: {
    '/a.md': { html: true, imageHosts: ['img.shields.io', 'github.com'], at: 7 },
    '/b.md': { html: false, imageHosts: ['example.com'], at: 8 },
    '/c.md': { html: true, imageHosts: [], at: 9 },
  },
}, null, 2)}\n`;

test('a trust.json from v0.1.0 with imageHosts still loads: HTML grants kept, hosts ignored', () => {
  const parsed = parseTrustFile(new TextEncoder().encode(V1_WITH_HOSTS));
  assert.equal(parsed.kind, 'ok');
  if (parsed.kind !== 'ok') return;
  assert.deepEqual(parsed.envelope.documents['/a.md'], { html: true, at: 7 });
  assert.deepEqual(parsed.envelope.documents['/c.md'], { html: true, at: 9 });
  assert.equal(parsed.envelope.documents['/b.md'], undefined, 'a host-only entry grants nothing');
  const store = createTrustStore(parsed.envelope, async () => {});
  assert.deepEqual(store.grantsFor('/a.md'), { html: true });
  assert.deepEqual(store.grantsFor('/b.md'), { html: false });
});

test('the next write after loading a v0.1.0 file drops imageHosts and keeps HTML grants', async () => {
  const parsed = parseTrustFile(new TextEncoder().encode(V1_WITH_HOSTS));
  assert.equal(parsed.kind, 'ok');
  if (parsed.kind !== 'ok') return;
  const disk: string[] = [];
  const store = createTrustStore(parsed.envelope, async (bytes) => { disk.push(new TextDecoder().decode(bytes)); });
  await store.grant('/d.md', { html: true });
  const written = disk.at(-1) ?? '';
  assert.doesNotMatch(written, /imageHosts|shields|example\.com/);
  const back = JSON.parse(written);
  assert.equal(back.version, 1);
  assert.equal(back.documents['/a.md'].html, true);
  assert.equal(back.documents['/d.md'].html, true);
});

test('loading a v0.1.0 file does not rewrite it', async () => {
  const writes: string[] = [];
  const store = await loadTrust({
    readFile: async () => new TextEncoder().encode(V1_WITH_HOSTS),
    writeFileAtomic: async (p) => { writes.push(p); },
    dataDirectory: async () => '/data',
  });
  assert.equal(store.grantsFor('/a.md').html, true);
  assert.deepEqual(writes, []);
});

test('corrupt trust.json is quarantined as .bad-<ts>', () => {
  const bad = parseTrustFile(new TextEncoder().encode('{not json'));
  assert.equal(bad.kind, 'quarantined');
  assert.match(quarantinePathFor('/data/trust.json', 123), /\.bad-123$/);
});

test('serialize round-trips grants', () => {
  const envelope = { ...emptyTrustEnvelope(), documents: { '/x.md': { html: true, at: 1 } } };
  const parsed = parseTrustFile(serializeTrustFile(envelope));
  assert.equal(parsed.kind, 'ok');
  if (parsed.kind === 'ok') {
    assert.equal(parsed.envelope.documents['/x.md'].html, true);
    assert.deepEqual(Object.keys(parsed.envelope.documents['/x.md']).sort(), ['at', 'html']);
  }
});

test('a grant then a revoke started together: a failed grant write leaves only the revoke on disk and in memory (MARXY-337)', async () => {
  let n = 0;
  const disk: string[] = [];
  const store = createTrustStore(
    { version: 1, documents: { '/x.md': { html: true, at: 1 } } },
    async (bytes) => {
      const i = ++n;
      await new Promise((r) => setTimeout(r, 5));
      if (i === 1) throw new Error('disk full');
      disk.push(new TextDecoder().decode(bytes));
    },
  );
  const r = await Promise.allSettled([
    store.grant('/y.md', { html: true }),
    store.revoke('/x.md', 'html'),
  ]);
  assert.deepEqual(r.map((x) => x.status), ['rejected', 'fulfilled']);
  assert.equal(store.grantsFor('/y.md').html, false);
  assert.equal(store.grantsFor('/x.md').html, false);
  assert.doesNotMatch(disk.at(-1) ?? '', /y\.md/);
});

test('two grants started together that both fail leave memory as it was (MARXY-337)', async () => {
  const store = createTrustStore(emptyTrustEnvelope(), async () => {
    await new Promise((r) => setTimeout(r, 5));
    throw new Error('nope');
  });
  const r = await Promise.allSettled([
    store.grant('/x.md', { html: true }),
    store.grant('/y.md', { html: true }),
  ]);
  assert.deepEqual(r.map((x) => x.status), ['rejected', 'rejected']);
  assert.deepEqual(store.grantsFor('/x.md'), { html: false });
});

test('a failed revoke keeps the committed grant, and a grant before it stays granted', async () => {
  let n = 0;
  const store = createTrustStore(emptyTrustEnvelope(), async () => {
    await new Promise((r) => setTimeout(r, 5));
    if (++n === 2) throw new Error('x');
  });
  const g = store.grant('/x.md', { html: true });
  const v = store.revoke('/x.md', 'html');
  const r = await Promise.allSettled([g, v]);
  assert.deepEqual(r.map((x) => x.status), ['fulfilled', 'rejected']);
  assert.equal(store.grantsFor('/x.md').html, true);
});

const TRUST_IO = (readFile: () => Promise<Uint8Array>, writes: Uint8Array[]) => ({
  readFile,
  writeFileAtomic: async (_p: string, b: Uint8Array) => { writes.push(b); },
  dataDirectory: async () => '/data',
});

test('a read failure other than not-found rejects, so no writer can replace trust.json (F-09)', async () => {
  const writes: Uint8Array[] = [];
  const io = TRUST_IO(async () => { throw Object.assign(new Error('EIO'), { code: 'io' }); }, writes);
  await assert.rejects(loadTrust(io), /EIO/);
  assert.equal(writes.length, 0);
});

test('a missing trust.json starts empty and a grant persists (F-09)', async () => {
  const writes: Uint8Array[] = [];
  const io = TRUST_IO(async () => { throw Object.assign(new Error('nope'), { code: 'not-found' }); }, writes);
  const store = await loadTrust(io);
  assert.equal(await store.grant('/a.md', { html: true }), true);
  assert.equal(writes.length, 1);
  assert.ok(JSON.parse(new TextDecoder().decode(writes[0])).documents['/a.md']);
});
