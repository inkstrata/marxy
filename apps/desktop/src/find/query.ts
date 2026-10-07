// Compiles what a reader types into a regular expression that matches what the page shows (D-03,
// docs/design/09-app-shell.md, Find). The article sets smart typography; a reader types straight quotes
// and double hyphens. The folding is applied to the query, never to the text.

const NBSP = '\\u00A0';

/**
 * Flags `giu`. Regex metacharacters are escaped; then `'` matches a straight or curly single quote,
 * `"` a straight or curly double quote, `---` an em dash, `--` an en dash, `...` an ellipsis, and a
 * space a space or a non-breaking space. Empty input returns null.
 */
export function compileQuery(input: string): RegExp | null {
  if (input.length === 0) return null;
  let source = '';
  let i = 0;
  while (i < input.length) {
    if (input.startsWith('---', i)) {
      source += '(?:---|\\u2014)';
      i += 3;
    } else if (input.startsWith('--', i)) {
      source += '(?:--|\\u2013)';
      i += 2;
    } else if (input.startsWith('...', i)) {
      source += '(?:\\.\\.\\.|\\u2026)';
      i += 3;
    } else {
      // Iterate by code point so the `u` flag never sees half a surrogate pair.
      const ch = String.fromCodePoint(input.codePointAt(i)!);
      i += ch.length;
      if (ch === "'") source += '[\'\\u2018\\u2019]';
      else if (ch === '"') source += '["\\u201C\\u201D]';
      else if (ch === ' ') source += `[ ${NBSP}]`;
      else source += ch.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');
    }
  }
  return new RegExp(source, 'giu');
}
