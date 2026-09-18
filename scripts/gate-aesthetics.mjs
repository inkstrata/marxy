// Mechanical aesthetics gate (ADR-0014). Checks that can run before the renderer exists run now;
// grid conformance, rag metrics and screenshot diffs switch on when apps/desktop exposes a headless
// render entry (MARXY-25). Fails hard once MARXY_AESTHETICS_REQUIRED=1 is set in CI (Phase 1).
import { readFileSync, existsSync } from 'node:fs';
const tokens = readFileSync(new URL('../packages/theme/src/tokens.css', import.meta.url), 'utf8');
const get = k => (tokens.match(new RegExp(`${k}:\\s*([^;]+);`)) || [])[1];
const lineBox = parseFloat(get('--marxy-line-box')), body = parseFloat(get('--marxy-size-body'));
const measure = parseFloat(get('--marxy-measure'));
const fails = [];
if (!(measure >= 60 && measure <= 75)) fails.push(`measure ${measure}ch outside 60–75ch (constraint 1)`);
if (!(lineBox / body >= 1.5 && lineBox / body <= 1.75)) fails.push(`line box ${lineBox}/${body} outside 1.5–1.75 (constraint 2)`);
// contrast of the default light pair, WCAG relative luminance
const lum = hex => { const c = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const cr = contrast(get('--marxy-color-text').trim(), get('--marxy-color-bg').trim());
if (cr < 7) fails.push(`body contrast ${cr.toFixed(2)} < 7:1 (constraint 4)`);
const renderer = existsSync(new URL('../apps/desktop/dist/render.js', import.meta.url));
if (!renderer && process.env.MARXY_AESTHETICS_REQUIRED === '1') fails.push('headless render entry missing; grid/rag/screenshot checks cannot run');
if (fails.length) { console.error('aesthetics gate failed:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log(`aesthetics gate ok: measure ${measure}ch, line box ${lineBox}px, contrast ${cr.toFixed(2)}:1${renderer ? '' : ' (grid/rag/screenshot checks pending MARXY-25)'}`);
