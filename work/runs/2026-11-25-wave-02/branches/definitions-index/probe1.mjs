import { fromMarkdown } from 'file:///C:/Dev/reader/worktrees/definitions-index/node_modules/.pnpm/mdast-util-from-markdown@2.1.0/node_modules/mdast-util-from-markdown/index.js';
import { gfmFootnote } from 'file:///C:/Dev/reader/worktrees/definitions-index/node_modules/.pnpm/micromark-extension-gfm-footnote@2.1.0/node_modules/micromark-extension-gfm-footnote/index.js';
import { gfmFootnoteFromMarkdown } from 'file:///C:/Dev/reader/worktrees/definitions-index/node_modules/.pnpm/mdast-util-gfm-footnote@2.1.0/node_modules/mdast-util-gfm-footnote/index.js';

const cases = [
  '# [Foo]\n[foo]: /url\n',
  '# [Foo]\n\n[foo]: /url\n',
  '> # [Foo]\n\n[foo]: /url\n',
  '| a |\n| - |\n| [Foo] |\n\n[foo]: /url\n',
  '- # [Foo]\n- x\n\n> [foo]: /url\n',
  '[Foo]\n\n> - [foo]: /url\n',
  'a[^x]\n\n[^x]: note\n',
  '# a[^x]\n\n> [^x]: note\n',
];
for (const c of cases) {
  const t = fromMarkdown(c, { extensions: [gfmFootnote()], mdastExtensions: [gfmFootnoteFromMarkdown()] });
  const types = [];
  const walk = (n) => { types.push(n.type); (n.children ?? []).forEach(walk); };
  walk(t);
  console.log(JSON.stringify(c), types.filter((x) => /Reference|link|definition|Definition/i.test(x)).join(','));
}
