import { fromMarkdown } from 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/node_modules/mdast-util-from-markdown/index.js';
import { gfm } from 'file:///C:/Dev/reader/worktrees/definitions-index/packages/core/node_modules/micromark-extension-gfm/index.js';
const run = (c: string, set: string) => {
  let seen = false, early = false;
  const hook = { name: 'p', partial: true, tokenize(this: any, _e: unknown, _o: unknown, nok: unknown) { if (!seen) { seen = true; early = this.parser.defined.length > 0; } return nok; } };
  const ext: any = { text: { 91: hook, 93: hook } };
  if (set === 'doc') ext.document = { 91: hook }; else ext.contentInitial = { 91: hook };
  fromMarkdown(c, { extensions: [gfm(), ext] });
  return seen ? (early ? 'EARLY' : 'ok') : 'never';
};
const full = '[İ]: <>\r\n---\r\n\r\n[^ẞ]:\r\n    [^1]\r\n\r\n*em* ![x][a\r\n b]\r\n[c d]: /u (t)\r\n\r\n\r\n';
const parts = full.split('\r\n\r\n');
for (const c of [full, ...parts, parts.slice(0, 2).join('\r\n\r\n'), parts.slice(1, 3).join('\r\n\r\n'), '[^ẞ]:\r\n    [^1]\r\n\r\n[c d]: /u (t)\r\n', '[^a]: x\n\n[c]: /u\n', '[^a]: x\n[c]: /u\n', 'x\n\n[^a]: x [c]\n\n[c]: /u\n']) console.log(JSON.stringify(c).slice(0, 80), 'doc', run(c, 'doc'), 'content', run(c, 'content'));
