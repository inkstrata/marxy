import { parseMessage, parseAddresses } from '../../../../../packages/core/src/mail/mime.ts';
const enc=new TextEncoder();
const m=(s)=>parseMessage(enc.encode(s.replace(/\n/g,'\r\n')));
for (const a of ['Jane <jane@y.org> (Boss)','jane@y.org (Jane Doe)','"Doe, J" <j@x> (c)','Jane Doe <jane@y.org>;','<a@b>','a@b, ,c@d','Joe <j@x>, Bob']) console.log(a,'=>',JSON.stringify(parseAddresses(a)));
// multipart/related without html first; text/html only; related with start
let r=m('Content-Type: multipart/related; boundary="b"\n\n--b\nContent-Type: text/html\n\n<img src="cid:x">\n--b\nContent-Type: image/png\nContent-ID: <x>\nContent-Transfer-Encoding: base64\n\niVBO\n--b--\n');
console.log(JSON.stringify({h:!!r.html,att:r.attachments.length,inline:[...r.inline.keys()]}));
// mixed: first child is multipart/alternative containing only html; second text plain attachment (no filename)
r=m('Content-Type: multipart/mixed; boundary="o"\n\n--o\nContent-Type: multipart/alternative; boundary="i"\n\n--i\nContent-Type: text/html\n\n<p>h</p>\n--i--\n--o\nContent-Type: text/plain\n\nsig text\n--o--\n');
console.log(JSON.stringify({h:r.html?.text(),t:r.text?.text(),att:r.attachments.map(a=>a.id)}));
// text only first part empty body, second part html
r=m('Content-Type: multipart/mixed; boundary="o"\n\n--o\nContent-Type: text/plain\n\n\n--o\nContent-Type: text/html\n\n<b>real</b>\n--o--\n');
console.log(JSON.stringify({h:r.html?.text(),t:r.text?.text(),att:r.attachments.map(a=>a.id)}));
// forwarded: mixed [text/plain, text/plain (forward-note, disposition inline)]
r=m('Content-Type: multipart/mixed; boundary="o"\n\n--o\nContent-Type: text/plain\n\nfirst\n--o\nContent-Type: text/plain\nContent-Disposition: inline\n\nsecond\n--o--\n');
console.log(JSON.stringify({t:r.text?.text(),att:r.attachments.map(a=>a.id)}));
// 8bit utf-8 without charset
r=parseMessage(enc.encode('Subject: x\r\n\r\ncafé ☕')); console.log(r.text?.text());
// html with charset meta only (no header charset) latin1 bytes
r=parseMessage(new Uint8Array([...enc.encode('Content-Type: text/html\r\n\r\n<meta charset="iso-8859-1">caf'),0xe9])); console.log(JSON.stringify(r.html?.text()));
// non-utf8 8bit with no charset header: latin1
r=parseMessage(new Uint8Array([...enc.encode('Subject: x\r\n\r\ncaf'),0xe9])); console.log(JSON.stringify(r.text?.text()));
// non-UTF8 raw header subject (latin1 bytes)
r=parseMessage(new Uint8Array([...enc.encode('Subject: caf'),0xe9,...enc.encode('\r\n\r\nx')])); console.log(JSON.stringify(r.subject));
