import { readSettings, parseConfig } from '/D:/Dev/marxy-wt/hunt-06/packages/theme/src/index.ts';
const t = (s) => {
  const r = readSettings(new TextEncoder().encode(s));
  const out = r.states.filter(x => x.changed || x.warning).map(x => `${x.row.key}: value=${JSON.stringify(x.value)} changed=${x.changed} ${x.warning ?? ''}`);
  console.log(JSON.stringify(s), '\n   ', out.join('\n    '), '\n    warnings:', parseConfig(new TextEncoder().encode(s)).warnings.join(' | '));
};
t('size = "big"\nvariant = "blue"\nmeasure = 200\ncontrast = "high"');
t('size = 12\nmeasure = 20\nchrome_size = 40');
t('size = 20.5\nversion_copies = 7');
t('theme = "Ink"\nvariant = "Dark"');
t('theme = 5\ncopy_format = "Markdown"');
t('size = 20\nsize = 22');
t('\ufeffsize = 22\r\nvariant = "light"\r\n');
t('line_numbers = "on"\ncolumn_guide = 1\nshow_whitespace = "true"');
