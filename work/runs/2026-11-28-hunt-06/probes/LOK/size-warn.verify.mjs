import { readSettings, parseConfig } from '../../../../../packages/theme/src/index.ts';
for (const s of ['size = 12\nmeasure = 20\nchrome_size = 40', 'size = 99\nmeasure = 200', 'theme = 5', 'size = "big"\nmeasure = "wide"']) {
  const p = parseConfig(new TextEncoder().encode(s));
  const r = readSettings(new TextEncoder().encode(s));
  console.log(JSON.stringify(s), '-> size', p.config.size, 'measure', p.config.measure, 'theme', p.config.theme, '\n  warnings:', JSON.stringify(p.warnings), '\n  readSettings warnings:', JSON.stringify(r.warnings));
}
