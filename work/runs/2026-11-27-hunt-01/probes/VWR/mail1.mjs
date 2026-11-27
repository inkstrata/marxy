import { parseMessage, decodeWords, parseAddresses, parseMailDate, decodeBase64, decodeQuotedPrintable, decodeCharset, parseParams } from '../../../../../packages/core/src/mail/mime.ts';
const enc = (s) => new TextEncoder().encode(s);
const dec = (b)=>new TextDecoder().decode(b);
const show=(k,v)=>console.log(k, JSON.stringify(v));
show('words adjacent', decodeWords('=?utf-8?q?a?= =?utf-8?q?b?='));
show('words split utf8', decodeWords('=?utf-8?B?w?= =?utf-8?B?qQ==?='));
show('words mixed', decodeWords('x =?utf-8?q?a_b?= y'));
show('words lang', decodeWords('=?utf-8*en?q?hi?='));
show('addr quoted comma', parseAddresses('"Doe, Jo" <jo@x.org>, b@y.org'));
show('addr group', parseAddresses('Team: a@x.org, b@x.org;'));
show('addr comment', parseAddresses('jo@x.org (Jo Doe)'));
show('addr escaped', parseAddresses('"a\\"b" <q@x.org>'));
show('date1', parseMailDate('Fri, 21 Nov 1997 09:55:06 -0600'));
show('date2', parseMailDate('21 Nov 97 09:55 EST'));
show('date3', parseMailDate('Thu, 31 Feb 2024 10:00:00 +0000'));
show('date4', parseMailDate('Mon, 1 Jan 2024 24:00:00 +0000'));
show('date5', parseMailDate('Mon, 1 Jan 2024 10:00:00 +9999'));
show('qp soft', dec(decodeQuotedPrintable(enc('a=\r\nb=3D=e9 =\nc'))));
show('qp bad', dec(decodeQuotedPrintable(enc('a=ZZb=4'))));
show('b64 ws', dec(decodeBase64('aGVs\r\nbG8=')));
show('b64 nopad', dec(decodeBase64('aGVsbG8')));
show('b64 url', Array.from(decodeBase64('-_-_')));
show('charset latin1', decodeCharset(new Uint8Array([0xe9,0x80]), 'iso-8859-1'));
show('charset bad', decodeCharset(new Uint8Array([0xe9]), 'x-nonsense'));
show('charset 2022', decodeCharset(enc('\x1b$B$"\x1b(B'), 'iso-2022-jp'));
show('rfc2231', parseParams('attachment; filename*=utf-8\'\'%E2%82%AC%20rates.txt'));
show('rfc2231 cont', parseParams('attachment; filename*0*=utf-8\'\'%E2%82; filename*1*=%AC.txt'));
show('param dup', parseParams('a; name=x; name=y'));
const m = parseMessage(enc([
'From: a@x.org','To: b@x.org','Subject: =?utf-8?q?h=C3=A9?=','Date: Fri, 21 Nov 1997 09:55:06 -0600','MIME-Version: 1.0',
'Content-Type: multipart/mixed; boundary="b1"','','preamble','--b1','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: quoted-printable','',
'caf=C3=A9 =','continued','--b1','Content-Type: application/octet-stream; name="../../evil.sh"','Content-Disposition: attachment; filename="..\\..\\evil.sh"','Content-Transfer-Encoding: base64','','aGk=','--b1--',''].join('\r\n')));
show('msg', {subject:m.subject, text:m.text?.text(), atts:m.attachments.map(a=>({n:a.filename,t:a.type,b:dec(a.bytes())}))});
// LF-only and bare-boundary-prefix
const m2 = parseMessage(enc('Content-Type: multipart/mixed; boundary=ab\n\n--abc\nnot a part\n--ab\n\nreal\n--ab--\n'));
show('prefix boundary', m2.text?.text() ?? null);
// text/plain with trailing CRLF boundary exactness
const m3 = parseMessage(enc('Content-Type: multipart/mixed; boundary=ab\r\n\r\n--ab\r\nContent-Type: text/plain\r\n\r\nline\r\n\r\n--ab--\r\n'));
show('trailing blank', m3.text?.text());
