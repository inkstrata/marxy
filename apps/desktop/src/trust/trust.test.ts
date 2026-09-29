// trust.json store: LRU, host normalisation, corrupt quarantine (MARXY-44).

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  TRUST_LRU_CAP,
  createTrustStore,
  emptyTrustEnvelope,
  normalizeImageHost,
  parseTrustFile,
  quarantinePathFor,
  serializeTrustFile,
} from './trust.ts';

function upsert(
  envelope: ReturnType<typeof emptyTrustEnvelope>,
  path: string,
  change: { html?: boolean; imageHosts?: readonly string[] },
) {
  const prev = envelope.documents[path];
  const html = change.html ?? prev?.html ?? false;
  const imageHosts = change.imageHosts ?? prev?.imageHosts ?? [];
  const at = Date.now();
  const documents = { ...envelope.documents, [path]: { html, imageHosts: [...imageHosts], at } };
  const keys = Object.keys(documents);
  if (keys.length <= TRUST_LRU_CAP) return { ...envelope, documents };
  const drop = keys
    .sort((a, b) => documents[a].at - documents[b].at)
    .slice(0, keys.length - TRUST_LRU_CAP);
  for (const key of drop) delete documents[key];
  return { ...envelope, documents };
}

test('normalizeImageHost punycode-normalises internationalised domains', () => {
  assert.equal(normalizeImageHost('IMG.shields.io'), 'img.shields.io');
  assert.equal(normalizeImageHost('münchen.de'), 'xn--mnchen-3ya.de');
});

test('LRU cap evicts the oldest document path', () => {
  let envelope = emptyTrustEnvelope();
  for (let i = 0; i < TRUST_LRU_CAP + 3; i++) {
    envelope = upsert(envelope, `/f${i}.md`, { html: true });
  }
  assert.equal(Object.keys(envelope.documents).length, TRUST_LRU_CAP);
  assert.ok(!envelope.documents['/f0.md']);
  assert.ok(!envelope.documents['/f1.md']);
  assert.ok(envelope.documents[`/f${TRUST_LRU_CAP + 2}.md`]);
});

test('grant merges image hosts without auto-granting a new host from the document', async () => {
  const store = createTrustStore(emptyTrustEnvelope(), async () => {});
  await store.grant('/a.md', { imageHosts: ['img.shields.io'] });
  assert.deepEqual(store.grantsFor('/a.md').imageHosts, ['img.shields.io']);
  assert.deepEqual(store.grantsFor('/b.md').imageHosts, []);
});

test('corrupt trust.json is quarantined as .bad-<ts>', () => {
  const bad = parseTrustFile(new TextEncoder().encode('{not json'));
  assert.equal(bad.kind, 'quarantined');
  assert.match(quarantinePathFor('/data/trust.json', 123), /\.bad-123$/);
});

test('serialize round-trips grants', () => {
  const envelope = upsert(emptyTrustEnvelope(), '/x.md', { html: true, imageHosts: ['a.example'] });
  const parsed = parseTrustFile(serializeTrustFile(envelope));
  assert.equal(parsed.kind, 'ok');
  if (parsed.kind === 'ok') {
    assert.equal(parsed.envelope.documents['/x.md'].html, true);
    assert.deepEqual(parsed.envelope.documents['/x.md'].imageHosts, ['a.example']);
  }
});
