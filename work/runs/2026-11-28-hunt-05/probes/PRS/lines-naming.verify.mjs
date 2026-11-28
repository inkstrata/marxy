import { linesNaming } from '../../../../../apps/desktop/src/left/doc-model.ts';
for (const n of [1000, 2000, 4000, 8000]) {
  let t = ''; const needles = [];
  for (let i = 0; t.length < 2_000_000; i++) { t += `Some prose about \`src/file${i}.ts\` and more words to pad the paragraph out a good while longer here.\n\n`; needles.push(`src/file${i}.ts`); }
  const w = needles.slice(0, n);
  const t0 = performance.now(); const r = linesNaming(t, w);
  console.log(`2 MB text, ${n} distinct paths: ${(performance.now() - t0).toFixed(0)} ms, ${r.length} hits`);
}
for (const size of [1e6, 2e6, 4e6]) {
  let t = ''; const needles = [];
  for (let i = 0; t.length < size; i++) { t += `Some prose about \`src/file${i}.ts\` and more words to pad the paragraph out a good while longer here.\n\n`; if (i < 2000) needles.push(`src/file${i}.ts`); }
  const t0 = performance.now(); linesNaming(t, needles);
  console.log(`${size / 1e6} MB text, 2000 paths: ${(performance.now() - t0).toFixed(0)} ms`);
}
