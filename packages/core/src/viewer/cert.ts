// An X.509 certificate (.cer, .crt, .pem, .der) read from its own bytes by a hand-written DER walk: who it names, who
// issued it, when it starts and ends, its key and whether it is a CA. Every fact is the certificate's own claim: nothing
// here checks a signature or a chain, and nothing asks a CA or a revocation list. A private key in the file is only
// noticed (by its PEM label or its DER shape) and never decoded, so none of its material reaches a fact. The bytes are
// untrusted: lengths are checked against the file, indefinite lengths and nesting past 16 are damage, the file is read
// to at most `CERT_READ_MAX` and a bundle lists at most `CERT_LIST_MAX`. Pure: no DOM, no I/O.

/** The most of a file that is read. */
export const CERT_READ_MAX = 1024 * 1024;
/** The most certificates a bundle lists; the rest are counted. */
export const CERT_LIST_MAX = 100;
/** DER nesting past this is damage. */
export const CERT_DEPTH_MAX = 16;
/** A name or other string is shown cut at this many characters. */
export const CERT_STRING_SHOWN = 200;

export interface CertName {
  readonly cn: string | null;
  readonly o: string | null;
  readonly c: string | null;
}

export interface CertFacts {
  readonly subject: CertName;
  readonly issuer: CertName;
  /** The issuer's name is, byte for byte, the subject's. */
  readonly selfIssued: boolean;
  /** Milliseconds since 1970 (UTC). */
  readonly notBefore: number;
  readonly notAfter: number;
  /** "RSA", "EC", "Ed25519" … */
  readonly keyType: string;
  /** RSA modulus bits (DSA's p); null for a curve key. */
  readonly keyBits: number | null;
  /** The curve's name for an EC key. */
  readonly curve: string | null;
  /** basicConstraints cA; null when the certificate carries no such extension. */
  readonly ca: boolean | null;
}

export type CertEntry = { readonly ok: true; readonly facts: CertFacts } | { readonly ok: false; readonly reason: string };

export interface CertFile {
  /** At most `CERT_LIST_MAX`, in file order. */
  readonly entries: readonly CertEntry[];
  /** Certificates past the list. */
  readonly more: number;
  /** The file holds a private key (never decoded or shown). */
  readonly holdsKey: boolean;
  /** The file is longer than what was read. */
  readonly cut: boolean;
}

export type CertRead =
  | { readonly ok: true; readonly file: CertFile }
  /** `notCert`: the bytes are neither PEM nor DER (a text file under a certificate's name), so it is a plain file. */
  | { readonly ok: false; readonly reason: string; readonly notCert?: boolean };

class Damaged extends Error {}
const bad = (reason: string): never => {
  throw new Damaged(reason);
};

const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
/** A string for display: controls, zero-width marks and bidirectional overrides become a replacement mark; long ones are cut. */
const clean = (s: string): string => {
  const t = s.replace(UNSAFE, '�').trim();
  return t.length > CERT_STRING_SHOWN ? `${t.slice(0, CERT_STRING_SHOWN)}…` : t;
};

// ---- DER ----

interface Node {
  readonly tag: number;
  readonly constructed: boolean;
  /** Content start and end. */
  readonly s: number;
  readonly e: number;
  /** Where the header begins, and where the next sibling does. */
  readonly h: number;
  readonly next: number;
}

/** The element at `at` within `[at, end)`; damage for an indefinite length, a long tag, or a length past `end`. */
function node(b: Uint8Array, at: number, end: number): Node {
  if (at + 2 > end) bad('a length runs past the end of the file');
  const t = b[at]!;
  if ((t & 0x1f) === 0x1f) bad('it uses a tag form DER does not allow here');
  let len = b[at + 1]!;
  let s = at + 2;
  if (len === 0x80) bad('it uses an indefinite length, which DER forbids');
  if (len > 0x80) {
    const n = len & 0x7f;
    if (n > 4) bad('a length is larger than the file can hold');
    if (s + n > end) bad('a length runs past the end of the file');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[s + i]!;
    s += n;
  }
  if (s + len > end) bad('a length runs past the end of the file');
  return { tag: t, constructed: (t & 0x20) !== 0, s, e: s + len, h: at, next: s + len };
}

/** The children of a constructed element. Depth is counted by the caller's `depth`; the walk checks it at every descent. */
function kids(b: Uint8Array, n: Node, depth: number): Node[] {
  if (depth > CERT_DEPTH_MAX) bad('it nests deeper than 16 levels');
  const out: Node[] = [];
  let at = n.s;
  while (at < n.e) {
    const k = node(b, at, n.e);
    out.push(k);
    at = k.next;
  }
  return out;
}

/** Walks the whole tree once, so depth and lengths are checked everywhere, not only where facts are read. */
function checkTree(b: Uint8Array, n: Node, depth: number): void {
  if (!n.constructed) return;
  for (const k of kids(b, n, depth)) checkTree(b, k, depth + 1);
}

function oid(b: Uint8Array, n: Node): string {
  if (n.tag !== 0x06 || n.e === n.s) return bad('an object identifier is malformed');
  const parts: number[] = [];
  let v = 0;
  let first = true;
  for (let i = n.s; i < n.e; i++) {
    const x = b[i]!;
    v = v * 128 + (x & 0x7f);
    if (v > 2 ** 40) bad('an object identifier is malformed');
    if ((x & 0x80) === 0) {
      if (first) {
        const a = v < 80 ? Math.floor(v / 40) : 2;
        parts.push(a, v - a * 40);
        first = false;
      } else parts.push(v);
      v = 0;
    }
  }
  if (v !== 0 || (b[n.e - 1]! & 0x80) !== 0) bad('an object identifier is malformed');
  return parts.join('.');
}

function str(b: Uint8Array, n: Node): string | null {
  const bytes = b.subarray(n.s, Math.min(n.e, n.s + CERT_STRING_SHOWN * 4 + 8));
  switch (n.tag) {
    case 0x0c:
      return clean(new TextDecoder('utf-8').decode(bytes));
    case 0x13:
    case 0x16:
    case 0x14:
      return clean(String.fromCharCode(...bytes));
    case 0x1e: {
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
      return clean(s);
    }
    default:
      return null;
  }
}

function name(b: Uint8Array, n: Node, depth: number): CertName {
  if (n.tag !== 0x30) bad('a name is not a sequence');
  const out: { cn: string | null; o: string | null; c: string | null } = { cn: null, o: null, c: null };
  for (const set of kids(b, n, depth)) {
    if (set.tag !== 0x31) bad('a name has a part that is not a set');
    for (const atv of kids(b, set, depth + 1)) {
      const [k, v] = kids(b, atv, depth + 2);
      if (atv.tag !== 0x30 || !k || !v) bad('a name part is malformed');
      const id = oid(b, k!);
      const key = id === '2.5.4.3' ? 'cn' : id === '2.5.4.10' ? 'o' : id === '2.5.4.6' ? 'c' : null;
      if (key && out[key] === null) out[key] = str(b, v!) || null;
    }
  }
  return out;
}

function time(b: Uint8Array, n: Node): number {
  const t = String.fromCharCode(...b.subarray(n.s, Math.min(n.e, n.s + 20)));
  const m = n.tag === 0x17 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(t) : n.tag === 0x18 ? /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(t) : null;
  if (!m) return bad('a date is not a UTC time the app can read');
  let year = Number(m[1]);
  // Two-digit years: 50 to 99 are 1950 to 1999, 00 to 49 are 2000 to 2049.
  if (n.tag === 0x17) year += year >= 50 ? 1900 : 2000;
  const [mo, d, h, mi, s] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) bad('a date is out of range');
  const ms = Date.UTC(year, mo - 1, d, h, mi, Math.min(s, 59));
  // A day the month does not have (31 Feb) would roll over into the next month.
  if (new Date(ms).getUTCDate() !== d) bad('a date is out of range');
  return ms;
}

const CURVES: Readonly<Record<string, string>> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.10': 'secp256k1',
  '1.3.36.3.3.2.8.1.1.7': 'brainpoolP256r1',
  '1.3.36.3.3.2.8.1.1.11': 'brainpoolP384r1',
};

const bitLength = (b: Uint8Array, n: Node): number => {
  let s = n.s;
  while (s < n.e && b[s] === 0) s++;
  return s === n.e ? 0 : (n.e - s - 1) * 8 + (32 - Math.clz32(b[s]!));
};

function keyOf(b: Uint8Array, spki: Node, depth: number): Pick<CertFacts, 'keyType' | 'keyBits' | 'curve'> {
  const [alg, bits] = kids(b, spki, depth);
  if (spki.tag !== 0x30 || !alg || !bits || bits.tag !== 0x03) bad('its public key is malformed');
  const [algId, params] = kids(b, alg!, depth + 1);
  if (!algId) bad('its public key is malformed');
  const id = oid(b, algId!);
  if (id === '1.2.840.113549.1.1.1') {
    // BIT STRING: one unused-bits byte, then RSAPublicKey { modulus, exponent }.
    const inner = node(b, bits!.s + 1, bits!.e);
    const [modulus] = kids(b, inner, depth + 2);
    if (inner.tag !== 0x30 || !modulus || modulus.tag !== 0x02) bad('its RSA key is malformed');
    return { keyType: 'RSA', keyBits: bitLength(b, modulus!), curve: null };
  }
  if (id === '1.2.840.10045.2.1') {
    const curve = params && params.tag === 0x06 ? CURVES[oid(b, params)] : undefined;
    return { keyType: 'EC', keyBits: null, curve: curve ?? 'a curve the app does not name' };
  }
  if (id === '1.2.840.10040.4.1') {
    const [p] = params && params.tag === 0x30 ? kids(b, params, depth + 2) : [];
    return { keyType: 'DSA', keyBits: p && p.tag === 0x02 ? bitLength(b, p) : null, curve: null };
  }
  const named: Record<string, string> = { '1.3.101.112': 'Ed25519', '1.3.101.113': 'Ed448', '1.3.101.110': 'X25519', '1.3.101.111': 'X448' };
  return { keyType: named[id] ?? `a key of type ${id}`, keyBits: null, curve: null };
}

function basicCa(b: Uint8Array, exts: Node, depth: number): boolean | null {
  // [3] EXPLICIT SEQUENCE OF Extension { id, critical BOOLEAN DEFAULT FALSE, value OCTET STRING }.
  const [list] = kids(b, exts, depth);
  if (!list || list.tag !== 0x30) bad('its extensions are malformed');
  for (const ext of kids(b, list!, depth + 1)) {
    const parts = kids(b, ext, depth + 2);
    const id = parts[0] ? oid(b, parts[0]) : bad('an extension is malformed');
    if (id !== '2.5.29.19') continue;
    const value = parts[parts.length - 1];
    if (!value || value.tag !== 0x04) bad('its basic constraints are malformed');
    const seq = node(b, value!.s, value!.e);
    if (seq.tag !== 0x30) bad('its basic constraints are malformed');
    const first = kids(b, seq, depth + 3)[0];
    return first !== undefined && first.tag === 0x01 && first.e - first.s === 1 && b[first.s] !== 0;
  }
  return null;
}

/** One certificate from its DER. */
function certificate(b: Uint8Array): CertFacts {
  const top = node(b, 0, b.length);
  if (top.tag !== 0x30) bad('it is not a certificate: it does not begin with a sequence');
  if (top.next !== b.length) {
    // Line ends or spaces after a DER file are not part of it; any other byte is.
    if (!b.subarray(top.next).every((x) => x === 0x20 || x === 0x09 || x === 0x0a || x === 0x0d)) bad('bytes follow the end of the certificate');
    b = b.subarray(0, top.next);
  }
  checkTree(b, top, 1);
  const [tbs] = kids(b, top, 1);
  if (!tbs || tbs.tag !== 0x30) return bad('it is not a certificate: no certificate body');
  const f = kids(b, tbs, 2);
  let i = 0;
  if (f[0]?.tag === 0xa0) i++;
  // serial, signature algorithm, issuer, validity, subject, public key
  const [serial, , issuer, validity, subject, spki] = [f[i], f[i + 1], f[i + 2], f[i + 3], f[i + 4], f[i + 5]];
  if (!serial || serial.tag !== 0x02 || !issuer || !validity || validity.tag !== 0x30 || !subject || !spki) bad('it is not a certificate: its body is the wrong shape');
  const [nb, na] = kids(b, validity!, 3);
  if (!nb || !na) bad('its validity is malformed');
  const exts = f.slice(i + 6).find((x) => x.tag === 0xa3);
  const same = issuer!.e - issuer!.h === subject!.e - subject!.h && b.subarray(issuer!.h, issuer!.e).every((x, j) => x === b[subject!.h + j]);
  return {
    subject: name(b, subject!, 3),
    issuer: name(b, issuer!, 3),
    selfIssued: same,
    notBefore: time(b, nb!),
    notAfter: time(b, na!),
    ...keyOf(b, spki!, 3),
    ca: exts ? basicCa(b, exts, 3) : null,
  };
}

/** Whether DER bytes have a private key's shape (PKCS#8, RSA's PKCS#1 or SEC1): noticed from the shape, never decoded. */
function derKey(b: Uint8Array): boolean {
  try {
    const top = node(b, 0, b.length);
    if (top.tag !== 0x30) return false;
    const k = kids(b, top, 1);
    // Encrypted PKCS#8: { { PBES1 or PBES2 id, ... }, OCTET STRING }.
    if (k[0]?.tag === 0x30 && k[1]?.tag === 0x04 && k.length === 2) {
      const id = kids(b, k[0], 2)[0];
      return !!id && oid(b, id).startsWith('1.2.840.113549.1.5.');
    }
    const v = k[0];
    if (!v || v.tag !== 0x02 || v.e - v.s !== 1) return false;
    if (k[1]?.tag === 0x30 && k[2]?.tag === 0x04) return true;
    if (k[1]?.tag === 0x02 && k[2]?.tag === 0x02) return true;
    return b[v.s] === 1 && k[1]?.tag === 0x04;
  } catch {
    return false;
  }
}

// ---- PEM ----

const B64 = new Int16Array(128).fill(-1);
'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.split('').forEach((c, i) => (B64[c.charCodeAt(0)] = i));

function base64(text: string): Uint8Array {
  const s = text.replace(/[ \t\r\n]/g, '');
  if (s.length === 0 || s.length % 4 !== 0) bad('its base64 is damaged: the length is not a multiple of four');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let v = 0;
    for (let j = 0; j < 4; j++) {
      const ch = s.charCodeAt(i + j);
      const x = s[i + j] === '=' && i + j >= s.length - pad ? 0 : ch < 128 ? B64[ch]! : -1;
      if (x < 0) bad('its base64 is damaged: a character is not base64');
      v = (v << 6) | x;
    }
    if (o < out.length) out[o++] = (v >> 16) & 0xff;
    if (o < out.length) out[o++] = (v >> 8) & 0xff;
    if (o < out.length) out[o++] = v & 0xff;
  }
  return out;
}

const entry = (der: () => Uint8Array): CertEntry => {
  try {
    return { ok: true, facts: certificate(der()) };
  } catch (e) {
    if (e instanceof Damaged) return { ok: false, reason: e.message };
    throw e;
  }
};

const BEGIN = '-----BEGIN ';
const DASHES = '-----';

/** Reads `bytes` (the first `CERT_READ_MAX` of the file; `total` is the file's size) as a PEM bundle or one DER certificate. */
export function readCertificates(bytes: Uint8Array, total: number = bytes.length): CertRead {
  const cut = total > bytes.length;
  const b = bytes.length > CERT_READ_MAX ? bytes.subarray(0, CERT_READ_MAX) : bytes;
  let text = '';
  for (let i = 0; i < b.length; i += 8192) text += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 8192)));
  if (text.indexOf(BEGIN) >= 0) {
    const entries: CertEntry[] = [];
    let more = 0;
    let holdsKey = false;
    let others = 0;
    let at = 0;
    for (;;) {
      const start = text.indexOf(BEGIN, at);
      if (start < 0) break;
      const labelEnd = text.indexOf(DASHES, start + BEGIN.length);
      const label = labelEnd < 0 ? '' : text.slice(start + BEGIN.length, labelEnd);
      if (labelEnd < 0 || label.length > 64 || /[\r\n]/.test(label)) {
        if (/PRIVATE KEY/i.test(text.slice(start, start + 80))) holdsKey = true;
        else entries.push({ ok: false, reason: 'a BEGIN line is not closed' });
        break;
      }
      // A key is a key whether or not its block ends, or ends under another label.
      const isKey = /PRIVATE KEY/i.test(label);
      if (isKey) holdsKey = true;
      const bodyStart = labelEnd + DASHES.length;
      const endMark = `-----END ${label}-----`;
      // A block cannot hold another BEGIN, so its END is looked for before the next one only: linear however many blocks.
      const nextBegin = text.indexOf(BEGIN, bodyStart);
      const endAt = text.slice(bodyStart, nextBegin < 0 ? text.length : nextBegin).indexOf(endMark);
      if (endAt < 0) {
        // Unended, or ended under another label: the scan goes on, so certificates after it are still listed.
        // A cut file may simply end inside its last block; a key's block is not reported.
        if (!isKey && !(cut && nextBegin < 0)) {
          if (entries.length < CERT_LIST_MAX) entries.push({ ok: false, reason: `its ${label.toLowerCase()} block never ends` });
          else more++;
        }
        if (nextBegin < 0) break;
        at = nextBegin;
        continue;
      }
      const end = bodyStart + endAt;
      at = end + endMark.length;
      if (isKey) continue;
      if (label !== 'CERTIFICATE' && label !== 'X509 CERTIFICATE' && label !== 'TRUSTED CERTIFICATE') {
        others++;
        continue;
      }
      if (entries.length >= CERT_LIST_MAX) {
        more++;
        continue;
      }
      const body = text.slice(bodyStart, end).replace(/^[^\n]*:[^\n]*\n/gm, '');
      entries.push(entry(() => base64(body)));
    }
    if (entries.length === 0 && !holdsKey) return { ok: false, reason: others > 0 ? 'It holds PEM blocks that are not certificates (a public key or a request, say), which the app does not read here.' : 'It has no certificate in it.' };
    if (!holdsKey && entries.every((e) => !e.ok)) return { ok: false, reason: (entries[0] as { reason: string }).reason };
    return { ok: true, file: { entries, more, holdsKey, cut } };
  }
  if (b.length > 0 && b[0] === 0x30) {
    if (derKey(b)) return { ok: true, file: { entries: [], more: 0, holdsKey: true, cut } };
    const e = entry(() => b);
    if (!e.ok) return { ok: false, reason: e.reason };
    return { ok: true, file: { entries: [e], more: 0, holdsKey: false, cut } };
  }
  return { ok: false, reason: 'It is neither a PEM file nor a DER certificate.', notCert: true };
}

// ---- Words ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A date as the card says it, in UTC: `3 Jan 2025`. */
export function certDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The names a certificate gives: `Tidemark Root, Tidemark Harbour Works, GB`, or that it names none. */
export function nameWords(n: CertName): string {
  const parts = [n.cn, n.o, n.c].filter((x): x is string => !!x);
  return parts.length ? parts.join(', ') : 'no name it gives';
}

export function keyWords(f: CertFacts): string {
  if (f.curve) return `${f.keyType}, curve ${f.curve}`;
  return f.keyBits ? `${f.keyType}, ${f.keyBits} bits` : f.keyType;
}

export function endWords(f: CertFacts, now: number): string {
  return f.notAfter < now ? `ended on ${certDate(f.notAfter)}` : `ends on ${certDate(f.notAfter)}`;
}

export function certKicker(file: CertFile): string {
  const n = file.entries.filter((e) => e.ok).length + file.more;
  if (n === 0 && file.holdsKey) return 'A private key';
  if (n === 0) return 'A certificate the app cannot read';
  const certs = n === 1 ? 'A certificate' : `A bundle of ${n} certificates`;
  return file.holdsKey ? `${certs} and a private key` : certs;
}

export interface CertRow {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

/** The card's rows, as words. `now` decides "ended"; nothing else is looked up. */
export function certRows(file: CertFile, now: number): CertRow[] {
  const rows: CertRow[] = [];
  const good = file.entries.filter((e): e is { ok: true; facts: CertFacts } => e.ok);
  if (file.entries.length === 1 && good.length === 1 && file.more === 0) {
    const f = good[0]!.facts;
    rows.push(
      { label: 'subject', value: nameWords(f.subject), note: 'who the certificate names' },
      { label: 'issuer', value: nameWords(f.issuer), note: f.selfIssued ? 'it names itself as its issuer' : undefined },
      { label: 'starts', value: `${certDate(f.notBefore)}`, note: f.notBefore > now ? 'not yet' : undefined },
      { label: 'ends', value: endWords(f, now) },
      { label: 'key', value: keyWords(f) },
      { label: 'CA', value: f.ca === true ? 'yes, it may issue certificates' : f.ca === false ? 'no' : 'no, it carries no basic constraints' },
    );
  } else {
    file.entries.forEach((e, i) => {
      if (!e.ok) return void rows.push({ label: `certificate ${i + 1}`, value: 'damaged', note: e.reason });
      const f = e.facts;
      rows.push({
        label: `certificate ${i + 1}`,
        value: nameWords(f.subject),
        note: `issued by ${nameWords(f.issuer)} · ${endWords(f, now)} · ${keyWords(f)}${f.ca === true ? ' · a CA' : ''}`,
      });
    });
    if (file.more > 0) rows.push({ label: 'more', value: `${file.more} more certificates are not listed`, note: `The card lists the first ${CERT_LIST_MAX}.` });
  }
  if (file.holdsKey) rows.push({ label: 'private key', value: 'This file holds a private key.', note: 'The card shows none of it.' });
  if (file.cut) rows.push({ label: 'read', value: `Only the first ${CERT_READ_MAX / 1024 / 1024} MB were read.` });
  return rows;
}
