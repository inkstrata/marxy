import { parseMessage, parseAddresses, parseMailDate, decodeWords } from '../../../../../packages/core/src/mail/mime.ts';
const enc=new TextEncoder();
const m=(s)=>parseMessage(enc.encode(s.replace(/\n/g,'\r\n')));
const show=(n,x)=>console.log('=== '+n+'\n'+JSON.stringify(x));
let r;
r=m('From: a@b\nSubject: x\n\nbody'); show('plain',{t:r.text?.text(),att:r.attachments.length});
r=m('From: a@b\nSubject: x\nContent-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n\ncaf=E9 =\nsoft'); show('qp-latin1',r.text?.text());
r=m('Subject: =?UTF-8?B?w6k=?= =?UTF-8?Q?=C3=A9=5Ffoo_bar?=\n\n'); show('words',r.subject);
r=m('Subject: =?UTF-8?B?4pyT?= and =?utf-8?B?4pyT?=\n\n'); show('words2',r.subject);
// split multibyte across encoded words
r=m('Subject: =?UTF-8?B?w6k=?==?UTF-8?Q?x?=\n\n'); show('adjacent',r.subject);
r=m('Subject: =?UTF-8?Q?=E2=82?= =?UTF-8?Q?=AC?=\n\n'); show('split-multibyte',r.subject);
show('addr1',parseAddresses('"Doe, John" <j@x.com>, Jane <jane@y.org> (Boss, Jr)'));
show('addr2',parseAddresses('john@x.com (John, Jr.), b@y'));
show('addr3',parseAddresses('=?UTF-8?Q?J=C3=BCrgen_M=C3=BCller?= <j@m.de>'));
show('addr4',parseAddresses('undisclosed-recipients:;'));
show('addr5',parseAddresses('Team: a@x, b@y;, c@z'));
show('addr-name-colon',parseAddresses('Re: Bob <b@x>'));
show('addr-quoted-at',parseAddresses('"a@b c" <x@y>'));
show('date1',parseMailDate('Sat, 28 Nov 2026 08:14:09 +0100'));
show('date2',parseMailDate('28 Nov 2026 08:14 GMT (comment)'));
show('date3',parseMailDate('Sat, 28 Nov 26 08:14:09 +0100'));
show('date-yr-1',parseMailDate('Sat, 28 Nov 126 08:14:09 +0100'));
// alternative with html last and text
r=m('Content-Type: multipart/alternative; boundary="b"\n\n--b\nContent-Type: text/plain\n\nplain\n--b\nContent-Type: text/html\n\n<p>h</p>\n--b--\n'); show('alt',{t:r.text?.text(),h:r.html?.text(),att:r.attachments.length});
// mixed w/ attachment only
r=m('Content-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: application/pdf; name="a.pdf"\nContent-Transfer-Encoding: base64\n\nJVBERg==\n--b--\n'); show('mixed-only-att',{t:r.text?.text(),att:r.attachments.map(a=>a.filename)});
// mixed: inline text attachment filename first
r=m('Content-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: text/plain; name="n.txt"\nContent-Disposition: attachment; filename="n.txt"\n\nattached text\n--b\nContent-Type: text/plain\n\nreal body\n--b--\n'); show('mixed-att-first',{t:r.text?.text(),att:r.attachments.map(a=>a.filename)});
// boundary with trailing text / missing close
r=m('Content-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: text/plain\n\nno close'); show('no-close',{t:r.text?.text(),n:r.parts.length});
// preamble & epilogue
r=m('Content-Type: multipart/mixed; boundary=b\n\npreamble\n--b\n\nbody\n--b--\nepilogue'); show('unquoted-boundary',{t:r.text?.text()});
// empty message
r=m(''); show('empty',{subject:r.subject,t:r.text,att:r.attachments.length,parts:r.parts.length});
// nonascii filename rfc2231
r=m('Content-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: text/plain\n\nx\n--b\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename*0*=utf-8\'\'%E6%97%A5; filename*1*=%E6%9C%AC.txt\n\nzz\n--b--\n'); show('rfc2231',r.attachments.map(a=>a.filename));
r=m('Content-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: text/plain\n\nx\n--b\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename="=?UTF-8?B?5pel5pys?=.txt"\n\nzz\n--b--\n'); show('word-filename',r.attachments.map(a=>a.filename));
// charset: shift_jis, gb2312, koi8-r, utf-16
const sj=Uint8Array.from([0x93,0xfa,0x96,0x7b]);
const b=new Uint8Array([...enc.encode('Content-Type: text/plain; charset=shift_jis\r\n\r\n'),...sj]);
show('sjis',parseMessage(b).text?.text());
show('charset-quoted-utf8-bom',parseMessage(new Uint8Array([...enc.encode('Content-Type: text/plain; charset=utf-8\r\n\r\n'),0xef,0xbb,0xbf,0x68,0x69])).text?.text());
// message/rfc822 attachment
r=m('Content-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: text/plain\n\nbody\n--b\nContent-Type: message/rfc822\n\nSubject: inner\n\ninner body\n--b--\n'); show('rfc822',{att:r.attachments.map(a=>[a.type,a.size]),parts:r.parts.map(p=>p.id+':'+p.type)});
// header folded with tab, header with no space after colon
r=m('Subject:no space\nTo:a@b,\n\tc@d\n\n'); show('hdr',{s:r.subject,to:r.to});
// LF-only body with CR? bare CR line ends
r=parseMessage(enc.encode('Subject: x\r\rbody')); show('bare-cr',{s:r.subject,t:r.text?.text()});
// header-only no blank
r=parseMessage(enc.encode('Subject: x\nFrom: a@b')); show('headeronly',{s:r.subject,f:r.from});
// mbox From_ line
r=parseMessage(enc.encode('From a@b Sat Nov 28 08:14:09 2026\nSubject: mb\n\nbody')); show('mbox',{s:r.subject,t:r.text?.text()});
