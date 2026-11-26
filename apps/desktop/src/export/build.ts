// The page as Export writes it: one HTML file, no scripts and nothing from the network. Pure: the caller hands it the
// page's sanitised markup.

export type ExportColours = 'paper' | 'look';

export interface ExportColourSet {
  readonly bg: string;
  readonly text: string;
  readonly strong: string;
  readonly secondary: string;
  readonly rule: string;
  readonly codeBg: string;
  readonly face: string;
}

/** Ink on white, in a serif every system has: what a page meant for paper or for someone else's screen reads in. */
export const PAPER: ExportColourSet = {
  bg: '#ffffff',
  text: '#1d2023',
  strong: '#000000',
  secondary: '#444a50',
  rule: '#d9d5ce',
  codeBg: '#f4f3f0',
  face: 'Charter, "Iowan Old Style", Georgia, serif',
};

export interface ExportInput {
  readonly title: string;
  /** The page's markup, sanitised, without the page's own marks. */
  readonly html: string;
  readonly colours: ExportColourSet;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A CSS value from the page may not close the rule it sits in. */
const cssValue = (s: string): string => s.replace(/[;{}<>]/g, '').trim();

export function htmlDocument(input: Pick<ExportInput, 'title' | 'html' | 'colours'> & { readonly paper?: 'A4' | 'Letter' }): string {
  const c = Object.fromEntries(Object.entries(input.colours).map(([k, v]) => [k, cssValue(v)])) as unknown as ExportColourSet;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(input.title)}</title>`,
    '<style>',
    `body { margin: 0; background: ${c.bg}; color: ${c.text}; font: 19px/1.55 ${c.face}; }`,
    'article { max-width: 33em; margin: 3em auto 5em; padding: 0 1.2em; }',
    `h1, h2, h3, h4, strong { color: ${c.strong}; line-height: 1.25; }`,
    'code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .86em; }',
    `pre { overflow-x: auto; padding: .8em 1em; border-radius: 6px; background: ${c.codeBg}; }`,
    `table { border-collapse: collapse; } th, td { text-align: left; padding: .25em 1.2em .25em 0; border-bottom: 1px solid ${c.rule}; }`,
    `blockquote { margin-left: 0; padding-left: 1em; border-left: 2px solid ${c.rule}; color: ${c.secondary}; }`,
    'a { color: inherit; } img { max-width: 100%; }',
    `aside { margin: 0 0 1em; padding: .1em 0 .1em .8em; border-left: 2px solid ${c.rule}; font-size: .82em; color: ${c.secondary}; }`,
    ...(input.paper ? [`@page { size: ${input.paper === 'Letter' ? 'letter' : 'A4'}; margin: 18mm; }`] : []),
    '</style>',
    '</head>',
    '<body>',
    '<article>',
    input.html,
    '</article>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** `name` with its extension replaced by `extension` ("plan.md" to "plan.html"; a name with none gets one). */
export function exportName(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${extension}`;
}
