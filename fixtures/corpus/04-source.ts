import { getBridge, type Bridge } from './bridge';
const scriptStart = Date.now();
const app = document.getElementById('app')!;
const raf = () => new Promise<number>(r => requestAnimationFrame(r));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await raf(); };

async function main() {
  const b = await getBridge();
  await b.mark('script_start', scriptStart, b.name);
  const argv = await b.args();
  const opt = (k: string, d = '') => { const a = argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const mode = opt('mode', new URLSearchParams(location.search).get('mode') || 'doc');
  const file = opt('file');
  try {
    if (mode === 'doc') await docMode(b, file);
    else if (mode === 'specimen') await specimenMode(b, +opt('offset', '0'), +opt('size', '17'));
    else if (mode === 'typeset') await typesetMode(b, file);
    else if (mode === 'cm6') await cm6Mode(b, file);
    else if (mode === 'index') await indexMode(b, opt('root'));
  } catch (e) { await b.mark('error', Date.now(), String(e)); }
  await frames(2);
  if (opt('shot')) { await b.screenshot(opt('shot')); await b.mark('shot', Date.now(), opt('shot')); }
  await b.mark('ready', Date.now());
  if (argv.includes('--quit')) await b.quit();
}

async function docMode(b: Bridge, file: string) {
  const src = await b.readFile(file);
  await b.mark('file_read', Date.now());
  const { default: MarkdownIt } = await import('markdown-it');
  const md = new MarkdownIt({ html: false, linkify: false, typographer: true });
  const html = md.render(src);
  await b.mark('parsed', Date.now());
  app.innerHTML = `<article class="column">${html}</article>`;
  await frames(1);
  await b.mark('first_paint_frame', Date.now());
  await document.fonts.ready;
  await frames(1);
  await b.mark('first_text', Date.now(), 'fonts-ready');
}

async function specimenMode(b: Bridge, offset: number, size: number) {
  const faces = [['Literata', 'Literata'], ['Quattro', 'Quattro']];
  const weights = [300, 350, 400, 450, 500, 550, 600, 650, 700];
  const methods = ['font-weight', 'fvs'];
  const text = size === 17 ? 'Hamburgefonstiv 0123 qu' : 'Hamburgefo 01';
  const lh = size === 17 ? 24 : 44;
  let html = '<div class="spec">';
  for (const wgt of weights) {
    html += '<div class="row">';
    for (const [face, fam] of faces) for (const m of methods) {
      const req = wgt - offset;
      const style = m === 'font-weight' ? `font-weight:${req}` : `font-weight:400;font-variation-settings:'wght' ${req}`;
      html += `<div class="cell"><div class="label">${face} ${m} ${size}px w${wgt}${offset ? ` (req ${req})` : ''}</div><div class="sample" data-face="${face}" data-size="${size}" data-weight="${wgt}" data-method="${m}" style="font-family:'${fam}';font-size:${size}px;line-height:${lh}px;height:${lh}px;${style}">${text}</div></div>`;
    }
    html += '</div>';
  }
  if (size === 17) {
    const req400 = 400 - offset, req600 = 600 - offset;
    html += `<div style="padding:12px 10px 0;width:640px"><div class="label">reading size: Literata 17/28, requested ${req400} body / ${req600} heading, 68ch</div>
    <div style="font-family:'Literata';font-size:21px;line-height:28px;font-weight:${req600};letter-spacing:-0.006em">The reader is judged on the fourth page</div>
    <div style="font-family:'Literata';font-size:17px;line-height:28px;font-weight:${req400};max-width:68ch">Every vertical space is an integer multiple of the body line box. Headings, code blocks, images, lists, blockquotes and math all land on it. The purpose is not tidiness on the first screen — it is that a long document never accumulates drift. <em>Italic at seventeen pixels</em> and <strong>bold inline</strong> and <code style="font-family:'JetBrainsMono';font-size:14px">inline code</code> in the run of text.</div>
    <div style="font-family:'Quattro';font-size:17px;line-height:28px;font-weight:${req400};max-width:68ch;margin-top:6px">Quattro at seventeen: every vertical space is an integer multiple of the body line box, and a long document never accumulates drift.</div></div>`;
  }
  html += '</div>';
  app.innerHTML = html;
  await document.fonts.ready;
  await frames(2);
  const pos = await b.innerPosition();
  const samples = [...document.querySelectorAll<HTMLElement>('.sample')].map((el, i) => { const r = el.getBoundingClientRect(); return { id: i, face: el.dataset.face, size: +el.dataset.size!, weight: +el.dataset.weight!, method: el.dataset.method, x: r.x, y: r.y, w: r.width, h: r.height }; });
  const manifest = { dpr: window.devicePixelRatio, offset, size, origin: { x: pos.x, y: pos.y }, scale: pos.scale, inner: { w: innerWidth, h: innerHeight }, ua: navigator.userAgent, samples };
  await b.mark('layout', Date.now(), JSON.stringify(manifest));
}

async function typesetMode(b: Bridge, file: string) {
  const src = await b.readFile(file);
  const { default: MarkdownIt } = await import('markdown-it');
  const md = new MarkdownIt({ html: false, typographer: true });
  // take the first eight real paragraphs
  const div = document.createElement('div'); div.innerHTML = md.render(src);
  const paras = [...div.querySelectorAll('p')].filter(p => p.textContent!.length > 220).slice(0, 4).map(p => p.outerHTML).join('');
  const box = (cls: string, cap: string) => `<div class="box ${cls}"><p class="cap">${cap}</p>${paras}</div>`;
  app.innerHTML = `<div class="ts">${box('native', 'native ragged (engine)')}${box('pretty', 'text-wrap: pretty (engine)')}${box('justify', 'native justify (engine)')}${box('justif', 'justif Knuth–Plass justify + hanging')}</div>`;
  await document.fonts.ready;
  const { justify } = await import('justif');
  const { hyphenateEnUS } = await import('justif/hyphenate/en-us');
  const t0 = performance.now();
  const c = justify(document.querySelectorAll('.justif p:not(.cap)'), { hyphenate: hyphenateEnUS, onSkip: (el: any, why: any) => console.log('skip', why) });
  await c.ready;
  await b.mark('justif_ms', Date.now(), String(Math.round(performance.now() - t0)));
  await frames(2);
}

async function cm6Mode(b: Bridge, file: string) {
  const src = await b.readFile(file);
  await b.mark('file_read', Date.now(), String(src.length));
  const { EditorView, lineNumbers } = await import('@codemirror/view');
  const { EditorState } = await import('@codemirror/state');
  const t0 = performance.now();
  const view = new EditorView({ state: EditorState.create({ doc: src, extensions: [lineNumbers()] }), parent: app });
  await frames(1);
  await b.mark('cm6_interactive', Date.now(), String(Math.round(performance.now() - t0)));
  const sc = view.scrollDOM; const deltas: number[] = []; let last = performance.now();
  for (let i = 0; i < 240; i++) { sc.scrollTop += 1200; await raf(); const now = performance.now(); deltas.push(now - last); last = now; }
  const s = [...deltas].sort((a, b2) => a - b2); const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  await b.mark('cm6_scroll', Date.now(), JSON.stringify({ frames: deltas.length, mean: +(deltas.reduce((a, c) => a + c, 0) / deltas.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), over16: deltas.filter(d => d > 16.7).length, over100: deltas.filter(d => d > 100).length, scrollTop: sc.scrollTop, lines: view.state.doc.lines }));
}

async function indexMode(b: Bridge, root: string) {
  app.innerHTML = `<div class="column"><p>indexing ${root}</p><input id="q" style="font:16px monospace;width:100%"><ol id="res"></ol></div>`;
  const r = await b.indexBuild(root);
  await b.mark('index_build', Date.now(), JSON.stringify(r));
  const words = ['ma', 'mar', 'marx', 'read', 'readme', 'src', 'src/ind', 'index', 'pack', 'packag', 'package.json', 'config', 'tsx', 'main', 'main.rs', 'lib', 'test', 'spec', 'doc', 'docs/', 'md', 'plan', 'report', 'css', 'theme', 'json', 'cargo', 'toml', 'yaml', 'lock', 'node', 'dist', 'build', 'view', 'mode', 'x', 'xy', 'xyz', 'q', 'qq'];
  const queries: string[] = []; while (queries.length < 200) for (const w of words) { for (let i = 1; i <= w.length && queries.length < 200; i++) queries.push(w.slice(0, i)); }
  const lat: number[] = []; const backend: number[] = []; const res = document.getElementById('res')!; const input = document.getElementById('q') as HTMLInputElement;
  for (const q of queries) { input.value = q; const t0 = performance.now(); const out = await b.indexQuery(q); res.innerHTML = out.top.slice(0, 12).map(x => `<li>${x}</li>`).join(''); await raf(); lat.push(performance.now() - t0); backend.push(out.ms); }
  const st = (xs: number[]) => { const s = [...xs].sort((a, c) => a - c); const q = (p: number) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); return { p50: q(0.5), p95: q(0.95), max: q(1) }; };
  await b.mark('index_query', Date.now(), JSON.stringify({ count: r.count, queries: queries.length, roundtrip_incl_render: st(lat), backend_only: st(backend) }));
}

main();
