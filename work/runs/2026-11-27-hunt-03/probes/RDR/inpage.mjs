import { bigFile } from '../gen.mjs';
const root = '/@fs' + process.cwd().replace(/\/apps\/desktop$/, '');
const AT = Number(process.env.AT || 0.97);
export default async ({ boot }) => {
  const page = await boot('plans/pg16-upgrade-plan.md');
  for (const kind of (process.env.KINDS || 'md-references,md-technical').split(',')) for (const size of [1000000, 2000000, 4900000]) {
    const { text } = await bigFile(kind, size);
    const out = { kind, size };
    try {
      const r = await Promise.race([page.evaluate(async ([root, text, AT]) => {
        const P = await import(root + '/packages/core/src/parse/parse.ts');
        const R = await import(root + '/packages/core/src/parse/reparse.ts');
        const N = await import(root + '/packages/core/src/render/pipeline.ts');
        const bytes = new TextEncoder().encode(text); const o = {};
        let t = performance.now(); const doc = P.parseMarkdown(bytes); o.parse = Math.round(performance.now() - t); o.blocks = doc.children.length;
        t = performance.now(); R.holdsDefinitionMark(bytes); o.mark = Math.round(performance.now() - t);
        t = performance.now(); N.renderDocumentSafeHtml(doc); o.render = Math.round(performance.now() - t);
        const at = text.lastIndexOf('\n\n', Math.floor(text.length * AT)) + 3;
        const after = bytes.slice(); after[at] = after[at] === 0x78 ? 0x79 : 0x78;
        t = performance.now(); R.reparseMarkdown(doc, bytes, after); o.reparse = Math.round(performance.now() - t); o.rp = JSON.stringify(R.lastReparse());
        return o;
      }, [root, text, Number(process.env.AT || 0.97)]), new Promise((_, rej) => setTimeout(() => rej(new Error('STALL 120s')), 120000))]);
      Object.assign(out, r);
    } catch (e) { out.err = String(e).slice(0, 200); }
    console.log(JSON.stringify(out));
  }
};
