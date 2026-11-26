// Builds the certificate samples beside this script by hand-written DER signed with Node's crypto. Every key here is
// generated for the tests, marked TEST ONLY, and protects nothing; none is a real certificate. The helpers are exported
// so the unit tests build their own variants (string types, date forms, hostile shapes). `node fixtures/certs/make-certs.mjs`
import { generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const lenBytes = (n) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff]);
export const tlv = (tag, content) => Buffer.from([tag, ...lenBytes(content.length), ...content]);
const cat = (...p) => Buffer.concat(p.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x))));
export const seq = (...p) => tlv(0x30, cat(...p));
export const set = (...p) => tlv(0x31, cat(...p));
export const ctx = (n, ...p) => tlv(0xa0 | n, cat(...p));
export const int = (n) => {
  const b = [];
  for (let v = BigInt(n); ; v >>= 8n) {
    b.unshift(Number(v & 0xffn));
    if (v >> 8n === 0n) break;
  }
  if (b[0] & 0x80) b.unshift(0);
  return tlv(0x02, b);
};
export const oid = (s) => {
  const p = s.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) {
    const g = [v & 0x7f];
    for (let x = v >> 7; x; x >>= 7) g.unshift((x & 0x7f) | 0x80);
    out.push(...g);
  }
  return tlv(0x06, out);
};
export const bits = (b) => tlv(0x03, cat([0], b));
export const octets = (b) => tlv(0x04, b);
export const bool = (v) => tlv(0x01, [v ? 0xff : 0]);
export const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
export const printable = (s) => tlv(0x13, Buffer.from(s, 'latin1'));
export const ia5 = (s) => tlv(0x16, Buffer.from(s, 'latin1'));
export const teletex = (s) => tlv(0x14, Buffer.from(s, 'latin1'));
export const bmp = (s) => tlv(0x1e, Buffer.from([...s].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff])));
const p2 = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
export const utcTime = (d) => tlv(0x17, Buffer.from(`${p2(d.getUTCFullYear() % 100)}${stamp(d)}`));
export const genTime = (d) => tlv(0x18, Buffer.from(`${d.getUTCFullYear()}${stamp(d)}`));
/** UTCTime up to 2049, GeneralizedTime from 2050, as RFC 5280 says. */
export const when = (d) => (d.getUTCFullYear() < 2050 ? utcTime(d) : genTime(d));

const OIDS = { cn: '2.5.4.3', o: '2.5.4.10', c: '2.5.4.6' };
/** A Name from `{ cn, o, c }`; `enc` picks the string type of every value but the country. */
export const nameOf = (n, enc = utf8) =>
  seq(...['c', 'o', 'cn'].filter((k) => n[k] !== undefined).map((k) => set(seq(oid(OIDS[k]), k === 'c' ? printable(n[k]) : enc(n[k])))));

const SIG = {
  rsa: seq(oid('1.2.840.113549.1.1.11'), tlv(0x05, [])),
  ec: seq(oid('1.2.840.10045.4.3.2')),
  ed: seq(oid('1.3.101.112')),
};

/** One certificate. `ca` true or false adds basicConstraints; null adds no extension. */
export function buildCert({ subject, issuer = subject, notBefore, notAfter, publicKey, signKey, kind, ca = null, subjectName, issuerName, serial = 1 }) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const ext = ca === null ? [] : [ctx(3, seq(seq(oid('2.5.29.19'), bool(true), octets(seq(...(ca ? [bool(true)] : []))))))];
  const tbs = seq(ctx(0, int(2)), int(serial), SIG[kind], issuerName ?? nameOf(issuer), seq(when(notBefore), when(notAfter)), subjectName ?? nameOf(subject), spki, ...ext);
  const sig = sign(kind === 'rsa' || kind === 'ec' ? 'sha256' : null, tbs, signKey);
  return seq(tbs, SIG[kind], bits(sig));
}

export const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;

if (process.argv[1]?.endsWith('make-certs.mjs')) {
  const out = (name, data) => writeFileSync(new URL(name, import.meta.url), data);
  const rsa = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
  const root = rsa();
  const leaf = rsa();
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ed = generateKeyPairSync('ed25519');
  const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const rootName = { cn: 'Tidemark Root', o: 'Tidemark Harbour Works', c: 'GB' };
  const rootDer = buildCert({ subject: rootName, notBefore: D(2026, 3, 14), notAfter: D(2050, 1, 1), publicKey: root.publicKey, signKey: root.privateKey, kind: 'rsa', ca: true });
  const leafDer = buildCert({ subject: { cn: 'tide.tidemark.test', o: 'Tidemark Harbour Works', c: 'GB' }, issuer: rootName, notBefore: D(2026, 3, 14), notAfter: D(2049, 12, 31), publicKey: leaf.publicKey, signKey: root.privateKey, kind: 'rsa', ca: false, serial: 2 });
  const oldDer = buildCert({ subject: { cn: 'old.tidemark.test', o: 'Tidemark Old Quay', c: 'GB' }, notBefore: D(2019, 1, 1), notAfter: D(2021, 1, 1), publicKey: ec.publicKey, signKey: ec.privateKey, kind: 'ec' });
  const edDer = buildCert({ subject: { cn: 'Tidemark Ed', o: 'Tidemark Harbour Works', c: 'GB' }, notBefore: D(2026, 3, 14), notAfter: D(2050, 6, 1), publicKey: ed.publicKey, signKey: ed.privateKey, kind: 'ed', ca: true });
  const keyDer = leaf.privateKey.export({ type: 'pkcs8', format: 'der' });
  const note = '# TEST ONLY: generated by fixtures/certs/make-certs.mjs for Marxy tests. It protects nothing.\n';
  out('tidemark-leaf.pem', pem('CERTIFICATE', leafDer));
  out('tidemark-root.cer', rootDer);
  out('tidemark-old.crt', pem('CERTIFICATE', oldDer));
  out('tidemark-ed.der', edDer);
  out('tidemark-bundle.pem', note + pem('CERTIFICATE', rootDer) + pem('CERTIFICATE', leafDer) + pem('CERTIFICATE', oldDer));
  out('test-only-key.pem', note + pem('PRIVATE KEY', keyDer));
  out('test-only-key.der', keyDer);
  out('test-only-ec-key.der', ec.privateKey.export({ type: 'sec1', format: 'der' }));
  out('test-only-combined.crt', note + pem('CERTIFICATE', leafDer) + pem('PRIVATE KEY', keyDer));
}
