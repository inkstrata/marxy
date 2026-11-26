// Smallest inputs on which a label is pushed before a document-only hook first runs.
import { fromMarkdown } from 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/node_modules/mdast-util-from-markdown/index.js';
import { gfm } from 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/node_modules/micromark-extension-gfm/index.js';

const L = ['[a]: /u', '> [a]: /u', '>[a]: /u', '- [a]: /u', '-\t[a]: /u', '\t[a]: /u', '   [a]: /u', '[^1]: n', 'x', '', '  - y', '[a]:', '/u', '1. x', '> > [a]: /u', '- - [a]: /u', '* [a]: /u', '\r', '\uFEFF[a]: /u', '[a]: /u\r', '```', '    [a]: /u'];
let s = 7;
const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (const set of [['document']]) {
  const early: string[] = [];
  for (let i = 0; i < 30000; i++) {
    const n = 1 + Math.floor(r() * 5);
    let c = '';
    for (let k = 0; k < n; k++) c += L[Math.floor(r() * L.length)] + '\n';
    let seen = false;
    let isEarly = false;
    const hook = { name: 'p', partial: true, tokenize(this: any, _e: unknown, _o: unknown, nok: unknown) { if (!seen) { seen = true; isEarly = this.parser.defined.length > 0 || (this.parser.gfmFootnotes?.length ?? 0) > 0; } return nok; } };
    const ext: any = { text: { 91: hook, 93: hook }, [set[0]!]: { 91: hook } };
    fromMarkdown(c, { extensions: [gfm(), ext] });
    if (isEarly) early.push(JSON.stringify(c));
  }
  early.sort((a, b) => a.length - b.length);
  console.log(set[0], early.length, early.slice(0, 8).join('  '));
}
