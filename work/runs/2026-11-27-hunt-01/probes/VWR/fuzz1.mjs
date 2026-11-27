import { parseMessage, decodeWords, parseAddresses, parseMailDate, decodeBase64, decodeQuotedPrintable, textLines, parseParams } from '../../../../../packages/core/src/mail/mime.ts';
import { readRtf } from '../../../../../packages/core/src/office/rtf.ts';
import { readShortcut } from '../../../../../packages/core/src/viewer/shortcut.ts';
import { readCertificates } from '../../../../../packages/core/src/viewer/cert.ts';
import { pageAsked, rangePieces, matchesIn, flattenOutline } from '../../../../../packages/core/src/viewer/pdf.ts';
import { parseOffset } from '../../../../../packages/core/src/viewer/hex.ts';
const enc = (s) => new TextEncoder().encode(s);
const cases = {
  deepMultipart: () => parseMessage(enc('Content-Type: multipart/mixed; boundary=a\r\n\r\n' + '--a\r\nContent-Type: multipart/mixed; boundary=a\r\n\r\n'.repeat(20000))),
  manyParts: () => parseMessage(enc('Content-Type: multipart/mixed; boundary=a\r\n\r\n' + '--a\r\n\r\nx\r\n'.repeat(200000))),
  manyBoundaries: () => { let s=''; for(let i=0;i<3000;i++) s+=`Content-Type: multipart/mixed; boundary=b${i}\r\n\r\n--b${i}\r\n`; return parseMessage(enc(s)); },
  longHeaders: () => parseMessage(enc('Subject: ' + '=?utf-8?q?a?= '.repeat(200000) + '\r\n\r\nx')),
  foldedHeader: () => parseMessage(enc('Subject: a\r\n' + ' b\r\n'.repeat(300000) + '\r\nx')),
  addrs: () => parseAddresses('"'.repeat(100000) + '<' .repeat(100000)),
  addrs2: () => parseAddresses('('.repeat(200000)),
  addrs3: () => parseAddresses('a,'.repeat(300000)),
  date: () => parseMailDate('1 ' + ' '.repeat(200000) + 'x'),
  b64: () => decodeBase64('A'.repeat(5e6)),
  qp: () => decodeQuotedPrintable(enc('=\r\n'.repeat(2e6))),
  params: () => parseParams('a; ' + 'x*0*=y;'.repeat(100000)),
  params2: () => parseParams('a; ' + '"'.repeat(200000)),
  rtfDeep: () => readRtf(enc('{\\rtf1' + '{'.repeat(500000) + 'x')),
  rtfTable: () => readRtf(enc('{\\rtf1' + '\\trowd\\cellx1000\\intbl x\\cell\\row'.repeat(50000) + '}')),
  rtfCtl: () => readRtf(enc('{\\rtf1' + '\\b0'.repeat(1e6) + '}')),
  rtfPict: () => readRtf(enc('{\\rtf1{\\pict\\pngblip ' + 'ab'.repeat(2e6) + '}}')),
  rtfList: () => readRtf(enc('{\\rtf1{\\listtable' + '{\\list\\listid1{\\listlevel\\levelnfc0}}'.repeat(20000) + '}' + '\\ls1 x\\par'.repeat(50000) + '}')),
  rtfField: () => readRtf(enc('{\\rtf1' + '{\\field{\\*\\fldinst HYPERLINK "http://a"}{\\fldrslt x}}'.repeat(50000) + '}')),
  rtfBin: () => readRtf(enc('{\\rtf1\\bin999999999 x}')),
  rtfUc: () => readRtf(enc('{\\rtf1\\uc999999999 \\u65 x}')),
  lnkJunk: () => readShortcut(new Uint8Array([0x4c,0,0,0,1,0x14,2,0,0,0,0,0,0xc0,0,0,0,0,0,0,0x46,...new Uint8Array(1000).fill(0xff)])),
  cert: () => readCertificates(enc('-----BEGIN CERTIFICATE-----\n' + 'A'.repeat(1e6) + '\n-----END CERTIFICATE-----\n'.repeat(1)), 1e6),
  certMany: () => readCertificates(enc('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n'.repeat(100000))),
  certBegins: () => readCertificates(enc('-----BEGIN CERTIFICATE-----\n'.repeat(100000))),
  certDer: () => readCertificates(new Uint8Array([0x30,0x84,0xff,0xff,0xff,0xff,...new Uint8Array(500).fill(0x30)])),
  certDeep: () => readCertificates(new Uint8Array([...new Uint8Array(100000).fill(0x30).flatMap(()=>[0x30,0x81,0xff]), 0])),
  pageAsked: () => pageAsked('9'.repeat(1e6), 10),
  rangePieces: () => rangePieces(0, 1e9, 1e9),
  matchesEmpty: () => matchesIn('x'.repeat(1e6), 1, /(?:)/g),
  offset: () => parseOffset('0x' + 'f'.repeat(1e6), 100),
  textLines: () => textLines('a\n'.repeat(1e6)),
};
for (const [k, f] of Object.entries(cases)) {
  const t = performance.now();
  try { const r = f(); const d = performance.now() - t; console.log(d > 500 ? 'SLOW' : 'ok  ', k, Math.round(d) + 'ms'); }
  catch (e) { console.log('THROW', k, Math.round(performance.now() - t) + 'ms', String(e).slice(0, 100)); }
}
