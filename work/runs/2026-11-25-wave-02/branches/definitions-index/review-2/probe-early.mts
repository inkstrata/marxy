// Which inputs push a label before a hook set H first runs? Uses micromark directly with a recording extension.
import { fromMarkdown } from 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/node_modules/mdast-util-from-markdown/index.js';
import { gfm } from 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/node_modules/micromark-extension-gfm/index.js';
const cases = ['[a]: /u\n', '> [a]: /u\n', '- [a]: /u\n', '- x\n\n  [a]: /u\n', '[^1]: n\n', '> [^1]: n\n', 'x\n\n[a]: /u\n', '1. [a]: /u\n', '> - [a]: /u\n', '  [a]: /u\n', '>\n> [a]: /u\n'];
for (const set of [['document'], ['contentInitial'], ['document', 'contentInitial']]) {
  const out: string[] = [];
  for (const c of cases) {
    let early = false; let seen = false;
    const hook = { name: 'p', partial: true, tokenize(this: any, _e: unknown, _o: unknown, nok: unknown) { if (!seen) { seen = true; early = this.parser.defined.length > 0 || (this.parser.gfmFootnotes?.length ?? 0) > 0; } return nok; } };
    const ext: any = { text: { 91: hook, 93: hook } };
    for (const s of set) ext[s] = { 91: hook };
    fromMarkdown(c, { extensions: [gfm(), ext] });
    out.push(`${JSON.stringify(c)}:${early ? 'EARLY' : 'ok'}${seen ? '' : '(never)'}`);
  }
  console.log(set.join('+'), out.join(' '));
}
