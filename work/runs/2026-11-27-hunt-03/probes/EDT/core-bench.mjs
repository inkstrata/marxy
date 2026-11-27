import { bigFile } from '../gen.mjs';
import { createBuffer, foldText, sourceTextOf, splice } from '../../../../../packages/core/src/buffer/index.ts';
const t = (f) => { const s = performance.now(); const r = f(); return [performance.now() - s, r]; };
for (const kind of ['md-prose', 'txt']) for (const bytes of [1e6, 2e6, 4.9e6]) {
  const { text } = await bigFile(kind, bytes);
  const bytesArr = new TextEncoder().encode(text);
  const [tc] = t(() => createBuffer('/a.md', bytesArr));
  const buf = createBuffer('/a.md', bytesArr);
  const [ts] = t(() => sourceTextOf(buf));
  const doc = sourceTextOf(buf).text;
  const mid = doc.length >> 1;
  const edited = doc.slice(0, mid) + 'x' + doc.slice(mid);
  const [tf, fold] = t(() => foldText(buf, edited));
  const [tsp, b2] = t(() => splice(buf, fold.range, fold.replacement));
  const [ts2] = t(() => sourceTextOf(b2));
  // many edits: 20 splices
  let b = buf; const s = performance.now();
  for (let i = 0; i < 20; i++) b = splice(b, { file: '/a.md', start: 1000 + i, end: 1000 + i }, new Uint8Array([120]));
  const t20 = performance.now() - s;
  const [tsrc] = t(() => sourceTextOf(b));
  console.log(kind, bytes, 'create', tc.toFixed(1), 'srcText', ts.toFixed(1), 'fold', tf.toFixed(1), 'splice', tsp.toFixed(1), 'srcText2', ts2.toFixed(1), '20splices', t20.toFixed(1), 'srcAfter', tsrc.toFixed(1));
}
