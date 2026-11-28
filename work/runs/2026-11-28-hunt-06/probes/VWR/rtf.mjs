// Small valid RTF documents through the reader. Backslash built by code: a heredoc would eat it.
import { readRtfOffice } from '../../../../../packages/core/src/office/index.ts';
const B = '\\';
const q = (s) => s.split('~').join(B);
const run = (name, src) => {
  try {
    const r = readRtfOffice(new TextEncoder().encode(q(src)));
    console.log('=== ' + name + '\n' + JSON.stringify(r.markdown));
  } catch (e) {
    console.log('=== ' + name + ' ERROR ' + e.message);
  }
};
run('plain', '{~rtf1~ansi Hello world~par}');
run('euro unicode', '{~rtf1~ansi~deff0 Price 5 ~u8364? and ~u20013?~u25991? done~par}');
run('astral', '{~rtf1~ansi ~u-10179?~u-8704? x~par}');
run('uc0', '{~rtf1~ansi~uc0 a~u233 b~par}');
run('uc2', '{~rtf1~ansi~uc2 a~u233 xxb~par}');
run('hex cp1252', "{~rtf1~ansi~ansicpg1252 caf~'e9 ~'80 ~'93q~'94~par}");
run('hex cp1251', "{~rtf1~ansi~ansicpg1251 ~'cf~'f0~'e8~'e2~'e5~'f2~par}");
run('hex cp932 pair', "{~rtf1~ansi~ansicpg932{~fonttbl{~f0~fnil~fcharset128 MS Mincho;}}~f0 ~'93~'fa~'96~'7b~par}");
run('two paras', '{~rtf1~ansi One~par Two~par}');
run('no final par', '{~rtf1~ansi One~par Two}');
run('line', '{~rtf1~ansi a~line b~tab c~par}');
run('bold italic', '{~rtf1~ansi plain ~b bold~b0  ~i it~i0 ~ul under~ulnone ~strike s~strike0~par}');
run('table', '{~rtf1~ansi~trowd~cellx2000~cellx4000~intbl A~cell B~cell~row~trowd~cellx2000~cellx4000~intbl C~cell D~cell~row~pard Done~par}');
run('list bullet', '{~rtf1~ansi{~*~listtable{~list~listid1{~listlevel~levelnfc23{~leveltext~\'01~u-3913 ?;}}}}{~*~listoverridetable{~listoverride~listid1~ls1}}~pard~ls1~ilvl0 item one~par~pard~ls1~ilvl0 item two~par}');
run('field hyperlink', '{~rtf1~ansi{~field{~*~fldinst HYPERLINK "https://example.org/x"}{~fldrslt link text}} after~par}');
run('header ignorable', '{~rtf1~ansi{~*~generator Foo;}{~info{~title T}}Body~par}');
run('footnote', '{~rtf1~ansi Text{~footnote ~pard~plain Note body}~par}');
run('non-breaking', '{~rtf1~ansi a~~ b~_ c~- d~par}');
run('quotes', '{~rtf1~ansi ~lquote a~rquote ~ldblquote b~rdblquote ~endash ~emdash ~bullet~par}');
run('escaped braces', '{~rtf1~ansi a ~{ b ~} c ~~ d~par}');
run('pict', '{~rtf1~ansi before {~pict~pngblip 89504e47}after~par}');
run('empty', '{~rtf1}');
run('crlf in text', '{~rtf1~ansi a\r\nb\r\n~par c}');
