import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CERT_LIST_MAX, certDate, certKicker, certRows, readCertificates, type CertFacts, type CertFile } from './cert.ts';

// The samples are built by fixtures/certs/make-certs.mjs, which also builds the variants below.
const sample = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/certs/${name}`, import.meta.url)));
// A variable path keeps the untyped script out of the type check.
const make: any = await import(String(new URL('../../../../fixtures/certs/make-certs.mjs', import.meta.url)));
const NOW = Date.UTC(2026, 10, 21);
const D = (y: number, m: number, d: number): Date => new Date(Date.UTC(y, m - 1, d));

const file = (bytes: Uint8Array): CertFile => {
  const r = readCertificates(bytes);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.file;
};
const first = (bytes: Uint8Array): CertFacts => {
  const e = file(bytes).entries[0]!;
  assert.ok(e.ok, e.ok ? '' : e.reason);
  return e.facts;
};
const reason = (bytes: Uint8Array): string => {
  const r = readCertificates(bytes);
  assert.ok(!r.ok);
  return r.reason;
};
const rowText = (f: CertFile, label: string): string | undefined => certRows(f, NOW).find((r) => r.label === label)?.value;
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

test('a PEM leaf names its subject and issuer, its dates, its RSA size and that it is no CA', () => {
  const f = first(sample('tidemark-leaf.pem'));
  assert.deepEqual(f.subject, { cn: 'tide.tidemark.test', o: 'Tidemark Harbour Works', c: 'GB' });
  assert.equal(f.issuer.cn, 'Tidemark Root');
  assert.equal(f.selfIssued, false);
  assert.equal(certDate(f.notBefore), '14 Mar 2026');
  assert.equal(certDate(f.notAfter), '31 Dec 2049');
  assert.equal(f.keyType, 'RSA');
  assert.equal(f.keyBits, 2048);
  assert.equal(f.ca, false);
  const rows = file(sample('tidemark-leaf.pem'));
  assert.equal(rowText(rows, 'subject'), 'tide.tidemark.test, Tidemark Harbour Works, GB');
  assert.equal(rowText(rows, 'ends'), 'ends on 31 Dec 2049');
  assert.equal(rowText(rows, 'key'), 'RSA, 2048 bits');
  assert.equal(rowText(rows, 'CA'), 'no');
  assert.equal(certKicker(rows), 'A certificate');
});

test('a DER root is a self-issued CA; an Ed25519 and an EC key are named by type and curve', () => {
  const root = first(sample('tidemark-root.cer'));
  assert.equal(root.ca, true);
  assert.equal(root.selfIssued, true);
  const ed = first(sample('tidemark-ed.der'));
  assert.equal(ed.keyType, 'Ed25519');
  assert.equal(ed.keyBits, null);
  const old = first(sample('tidemark-old.crt'));
  assert.equal(old.keyType, 'EC');
  assert.equal(old.curve, 'P-256');
  assert.equal(old.ca, null);
});

test('a certificate past its end says "ended on" its date; one not yet begun says so', () => {
  const old = file(sample('tidemark-old.crt'));
  assert.equal(rowText(old, 'ends'), 'ended on 1 Jan 2021');
  assert.equal(rowText(old, 'CA'), 'no, it carries no basic constraints');
  assert.equal(certRows(file(sample('tidemark-leaf.pem')), Date.UTC(2020, 0, 1)).find((r) => r.label === 'starts')?.note, 'not yet');
});

test('a bundle of three lists three rows, in file order', () => {
  const f = file(sample('tidemark-bundle.pem'));
  assert.equal(f.entries.length, 3);
  const rows = certRows(f, NOW);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.label), ['certificate 1', 'certificate 2', 'certificate 3']);
  assert.equal(rows[0]!.value, 'Tidemark Root, Tidemark Harbour Works, GB');
  assert.match(rows[0]!.note!, /a CA$/);
  assert.match(rows[2]!.note!, /ended on 1 Jan 2021/);
  assert.equal(certKicker(f), 'A bundle of 3 certificates');
});

test('a bundle is capped: the rest are counted, not listed', () => {
  const one = new TextDecoder().decode(sample('tidemark-leaf.pem'));
  const f = file(text(one.repeat(CERT_LIST_MAX + 5)));
  assert.equal(f.entries.length, CERT_LIST_MAX);
  assert.equal(f.more, 5);
  assert.match(certRows(f, NOW).at(-1)!.value, /^5 more certificates/);
});

test('a private key says it is there and nothing of it reaches the rows, the kicker or the reasons', () => {
  const body = new TextDecoder().decode(sample('test-only-key.pem')).split('\n').filter((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l));
  assert.ok(body.length > 5);
  for (const name of ['test-only-key.pem', 'test-only-key.der', 'test-only-combined.crt']) {
    const f = file(sample(name));
    assert.equal(f.holdsKey, true, name);
    const all = JSON.stringify([certKicker(f), certRows(f, NOW)]);
    for (const line of body) assert.ok(!all.includes(line.slice(0, 20)), name);
    assert.ok(!/MII|BEGIN|PRIVATE KEY-----/.test(all), name);
    assert.equal(rowText(f, 'private key'), 'This file holds a private key.');
  }
  assert.equal(certKicker(file(sample('test-only-key.pem'))), 'A private key');
  assert.equal(certKicker(file(sample('test-only-combined.crt'))), 'A certificate and a private key');
  assert.equal(file(sample('test-only-key.pem')).entries.length, 0);
});

test('a key block is not decoded: damaged base64 inside it is no damage', () => {
  const f = file(text('-----BEGIN PRIVATE KEY-----\n!!!! not base64 !!!!\n-----END PRIVATE KEY-----\n'));
  assert.equal(f.holdsKey, true);
});

test('malformed base64 and a block that never ends give a damaged reason', () => {
  assert.match(reason(text('-----BEGIN CERTIFICATE-----\nMIIB@@@@\n-----END CERTIFICATE-----\n')), /base64/);
  assert.match(reason(text('-----BEGIN CERTIFICATE-----\nMIIBAAAA\n')), /never ends/);
  assert.match(reason(text('-----BEGIN CERTIFICATE-----\nMII\n-----END CERTIFICATE-----\n')), /multiple of four/);
});

test('indefinite length, a length past the end, depth over 16 and trailing bytes are damage', () => {
  assert.match(reason(Uint8Array.of(0x30, 0x80, 0x00, 0x00)), /indefinite/);
  assert.match(reason(Uint8Array.of(0x30, 0x82, 0x10, 0x00, 0x30)), /past the end/);
  assert.match(reason(Uint8Array.of(0x30, 0x89, 1, 2, 3)), /larger than the file/);
  let deep = make.seq(make.int(1));
  for (let i = 0; i < 20; i++) deep = make.seq(deep);
  assert.match(reason(new Uint8Array(deep)), /deeper than 16/);
  const leaf = sample('tidemark-root.cer');
  assert.match(reason(Uint8Array.of(...leaf, 0)), /follow the end/);
  assert.match(reason(Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x01)), /not a certificate/);
});

test('bytes that are neither PEM nor DER are no certificate, and PEM with no certificate says what it holds', () => {
  const r = readCertificates(text('Some notes that were saved as .pem\n'));
  assert.ok(!r.ok && r.notCert);
  const pub = readCertificates(text('-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\n'));
  assert.ok(!pub.ok && !pub.notCert && /not certificates/.test(pub.reason));
});

test('names decode PrintableString, UTF8String, IA5String, BMPString and TeletexString, and are cleaned and cut', () => {
  const ed = generateKeyPairSync('ed25519');
  const build = (name: object, enc?: unknown): Uint8Array => {
    const subjectName = make.nameOf(name, enc);
    return new Uint8Array(make.buildCert({ subject: name, subjectName, notBefore: D(2026, 1, 1), notAfter: D(2027, 1, 1), publicKey: ed.publicKey, signKey: ed.privateKey, kind: 'ed' }));
  };
  assert.equal(first(build({ cn: 'Hörn Tide', o: 'Quay' }, make.utf8)).subject.cn, 'Hörn Tide');
  assert.equal(first(build({ cn: 'Quay Ltd' }, make.printable)).subject.cn, 'Quay Ltd');
  assert.equal(first(build({ cn: 'host.example' }, make.ia5)).subject.cn, 'host.example');
  assert.equal(first(build({ cn: '潮汐' }, make.bmp)).subject.cn, '潮汐');
  assert.equal(first(build({ cn: 'Café' }, make.teletex)).subject.cn, 'Café');
  const hostile = first(build({ cn: 'a‮b​c\u0007d' }, make.utf8)).subject.cn!;
  assert.ok(!/[‮​\u0007]/.test(hostile));
  const long = first(build({ cn: 'x'.repeat(5000) }, make.utf8)).subject.cn!;
  assert.equal(long.length, 201);
  assert.ok(long.endsWith('…'));
});

test('dates: UTCTime two-digit years pivot at 50, GeneralizedTime reads whole years', () => {
  const ed = generateKeyPairSync('ed25519');
  const build = (nb: Date, na: Date): CertFacts =>
    first(new Uint8Array(make.buildCert({ subject: { cn: 'd' }, notBefore: nb, notAfter: na, publicKey: ed.publicKey, signKey: ed.privateKey, kind: 'ed' })));
  const a = build(D(1999, 12, 31), D(2049, 12, 31));
  assert.equal(certDate(a.notBefore), '31 Dec 1999');
  assert.equal(certDate(a.notAfter), '31 Dec 2049');
  const b = build(D(1950, 1, 1), D(2051, 6, 1));
  assert.equal(certDate(b.notBefore), '1 Jan 1950');
  assert.equal(certDate(b.notAfter), '1 Jun 2051');
});

test('a PEM with Bag Attributes before it and header lines inside it still reads', () => {
  const pem = new TextDecoder().decode(sample('tidemark-leaf.pem'));
  const wrapped = `Bag Attributes\n    friendlyName: tide\nsubject=/CN=tide\n${pem.replace('\n', '\nProc-Type: 4,ENCRYPTED\n')}`;
  assert.equal(first(text(wrapped)).keyBits, 2048);
});

test('a key is a key whatever its block does: unended, mismatched, SEC1 or encrypted PKCS#8', () => {
  assert.equal(file(text('-----BEGIN RSA PRIVATE KEY-----\nMIIEow')).holdsKey, true);
  assert.equal(file(text('-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n')).holdsKey, true);
  assert.equal(file(text('-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----\n')).holdsKey, true);
  assert.equal(file(sample('test-only-ec-key.der')).holdsKey, true);
  const encrypted = make.seq(make.seq(make.oid('1.2.840.113549.1.5.13'), make.seq()), make.octets(Buffer.alloc(40, 7)));
  assert.equal(file(new Uint8Array(encrypted)).holdsKey, true);
  // Many unended key blocks must not be quadratic.
  assert.equal(file(text('-----BEGIN PRIVATE KEY-----\n'.repeat(40000))).holdsKey, true);
});

test('a key block with a mismatched END does not stop the scan: the certificate after it is listed', () => {
  const pem = new TextDecoder().decode(sample('tidemark-leaf.pem'));
  const f = file(text(`-----BEGIN PRIVATE KEY-----
AAAA
-----END RSA PRIVATE KEY-----
${pem}`));
  assert.equal(f.holdsKey, true);
  assert.equal(f.entries.length, 1);
  assert.ok(f.entries[0]!.ok);
  const g = file(text(`-----BEGIN CERTIFICATE-----
AAAA
${pem}`));
  assert.equal(g.entries.length, 2);
  assert.ok(!g.entries[0]!.ok && g.entries[1]!.ok);
});

test('a DER file may carry trailing line ends; other trailing bytes are damage', () => {
  const der = sample('tidemark-root.cer');
  assert.equal(first(Uint8Array.of(...der, 0x0a, 0x0d, 0x20)).ca, true);
  assert.match(reason(Uint8Array.of(...der, 0x0a, 0x41)), /follow the end/);
});

test('a date the month does not have is damage, not the next month', () => {
  const ed = generateKeyPairSync('ed25519');
  const tbsDate = (when: Buffer): Uint8Array => {
    const good = make.buildCert({ subject: { cn: 'd' }, notBefore: D(2026, 1, 1), notAfter: D(2027, 1, 1), publicKey: ed.publicKey, signKey: ed.privateKey, kind: 'ed' }) as Buffer;
    const stamp = Buffer.from('270101000000Z');
    const at = good.indexOf(stamp);
    assert.ok(at > 0);
    return new Uint8Array(Buffer.concat([good.subarray(0, at), when, good.subarray(at + stamp.length)]));
  };
  assert.match(reason(tbsDate(Buffer.from('270231000000Z'))), /out of range/);
  assert.equal(certDate(first(tbsDate(Buffer.from('270228000000Z'))).notAfter), '28 Feb 2027');
});

test('names lose C1 controls, line separators, soft hyphens and word joiners', () => {
  const ed = generateKeyPairSync('ed25519');
  const cert = new Uint8Array(make.buildCert({ subject: { cn: 'a\u0085b\u2028c\u00add\u2060e' }, notBefore: D(2026, 1, 1), notAfter: D(2027, 1, 1), publicKey: ed.publicKey, signKey: ed.privateKey, kind: 'ed' }));
  assert.ok(!/[\u0080-\u009f\u2028\u00ad\u2060]/.test(first(cert).subject.cn!));
});

test('hostile input: mutated, cut and random DER and PEM never throw and finish at once', () => {
  let seed = 7;
  const rnd = (n: number): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n);
  const bases = ['tidemark-root.cer', 'tidemark-ed.der', 'tidemark-leaf.pem', 'tidemark-bundle.pem', 'test-only-key.der'].map(sample);
  const t0 = Date.now();
  for (const base of bases) {
    for (let i = 0; i < 300; i++) {
      const b = new Uint8Array(base);
      for (let k = 0; k < 1 + rnd(4); k++) b[rnd(b.length)] = rnd(256);
      readCertificates(i % 3 === 0 ? b.subarray(0, rnd(b.length)) : b);
    }
  }
  for (let i = 0; i < 500; i++) readCertificates(Uint8Array.from({ length: rnd(300) }, () => (rnd(4) === 0 ? 0x30 : rnd(256))));
  // A huge claimed length, and a million BEGIN lines with no end, must not be quadratic.
  readCertificates(Uint8Array.of(0x30, 0x84, 0xff, 0xff, 0xff, 0xff));
  readCertificates(text('-----BEGIN CERTIFICATE-----\n'.repeat(40000)));
  assert.ok(Date.now() - t0 < 10_000);
});
