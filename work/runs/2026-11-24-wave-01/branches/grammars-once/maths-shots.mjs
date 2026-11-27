// Maths in headless Edge: a document with inline and display maths over a range of KaTeX's faces, its picture, and the
// state of every KaTeX face in document.fonts. Run from a tree: pnpm --filter @marxy/desktop shots <this file>
const DOC = '/maths/faces.md';
const TEXT = [
  '# Maths faces',
  '',
  'Inline: $\\alpha + \\beta \\leq \\gamma$, $\\Omega \\cdot \\Delta \\neq \\pi$, $\\frac{a}{b}$, $\\sqrt{x^2 + y^2}$,',
  '$\\mathbb{R}^n \\subseteq \\mathbb{C}^n$, $\\mathcal{L}(\\theta)$, $\\mathfrak{g}$, $\\mathscr{H}$, $\\mathsf{Sans}$, $\\mathtt{mono}$, $\\boldsymbol{\\mu}$.',
  '',
  '$$',
  '\\sum_{i=0}^{n} i = \\frac{n(n+1)}{2} \\qquad \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi} \\qquad \\prod_{k=1}^{\\infty} \\left(1 - \\frac{1}{p_k^{s}}\\right)^{-1}',
  '$$',
  '',
  '$$',
  'A = \\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix} \\quad \\det A = \\sqrt[3]{\\lambda_1 \\lambda_2} \\quad \\bigl( \\Bigl( \\biggl( \\Biggl( x \\Biggr) \\biggr) \\Bigr) \\bigr) \\quad \\nabla \\times \\vec{F} \\to \\aleph_0 \\otimes \\partial',
  '$$',
  '',
].join('\n');

export default async ({ boot, shot, plantText, open }) => {
  const page = await boot();
  await plantText(page, DOC, TEXT);
  await open(page, DOC, 2500);
  await page.waitForSelector('.katex');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const katex = [...document.fonts].filter((f) => f.family.replace(/["']/g, '').startsWith('KaTeX_'));
    const drawn = katex.map((f) => `${f.family.replace(/["']/g, '')} ${f.weight} ${f.style}: ${f.status}`);
    await Promise.allSettled(katex.map((f) => f.load()));
    const after = katex.map((f) => `${f.family.replace(/["']/g, '')} ${f.weight} ${f.style}: ${f.status}`);
    return { drawn, after, ua: navigator.userAgent };
  });
  console.log(`engine: ${fonts.ua}`);
  console.log('KaTeX faces after drawing the page (loaded = used by this page):');
  for (const f of fonts.drawn) console.log(`  ${f}`);
  console.log('KaTeX faces after asking each to load:');
  for (const f of fonts.after) console.log(`  ${f}`);
  const box = await page.evaluate(() => {
    const r = document.querySelector('#doc h1, article h1')?.getBoundingClientRect();
    return r ? { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 20) } : { x: 0, y: 0 };
  });
  await shot(page, 'maths-faces', { clip: { x: box.x, y: box.y, width: 1000, height: 520 } });
};
