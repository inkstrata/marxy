import { parseMessage } from '../../../../../packages/core/src/mail/mime.ts';
const enc = (s) => new TextEncoder().encode(s);
const msg = (n, extra = '') => enc(`From: a@b\r\nSubject: s\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n` + Array.from({ length: n }, (_, i) => `--B\r\nContent-Type: text/plain\r\n\r\npart ${i}\r\n`).join('') + extra + `--B--\r\n`);
for (const n of [498, 499, 500, 501, 600]) { const m = parseMessage(msg(n)); console.log('parts', n, 'children', m.root.children.length, 'capped', JSON.stringify(m.capped)); }
// no closing delimiter
for (const n of [499, 500]) { const m = parseMessage(enc(new TextDecoder().decode(msg(n)).replace('--B--\r\n', ''))); console.log('noclose', n, m.root.children.length, JSON.stringify(m.capped)); }
// headers
for (const n of [999, 1000, 1001]) { const h = Array.from({ length: n }, (_, i) => `X-${i}: v`).join('\r\n'); const m = parseMessage(enc(h + '\r\n\r\nbody')); console.log('headers', n, m.headers.length, JSON.stringify(m.capped)); }
// header bytes: Content-Type after 256KB
for (const pad of [262144 - 80, 262144, 262144 + 100]) { const m = parseMessage(enc(`X-Pad: ${'a'.repeat(pad)}\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n--B\r\n\r\nx\r\n--B--\r\n`)); console.log('hb', pad, m.root.type, m.root.children.length, JSON.stringify(m.capped)); }
// depth
for (const d of [11, 12, 13]) { let s = ''; for (let i = 0; i < d; i++) s += `Content-Type: multipart/mixed; boundary="b${i}"\r\n\r\n--b${i}\r\n`; s += 'Content-Type: text/plain\r\n\r\nleaf\r\n'; for (let i = d - 1; i >= 0; i--) s += `--b${i}--\r\n`; const m = parseMessage(enc(s)); console.log('depth', d, m.parts.length, 'leaves', m.leaves, JSON.stringify(m.capped)); }
// dash lines in an early part
{ const dashes = '--x\n'.repeat(1_000_001); const m = parseMessage(enc(`Content-Type: multipart/mixed; boundary="B"\r\n\r\n--B\r\nContent-Type: text/plain\r\n\r\n${dashes}\r\n--B\r\nContent-Type: text/plain\r\n\r\nsecond\r\n--B--\r\n`)); console.log('dash', m.root.children.length, JSON.stringify(m.capped), m.attachments.length, m.text?.text()?.length); }
