// Rewrites theme CSS url() and @import values: local asset URLs only (MARXY-47, docs/design/05-theme.md §Loader).

function normalizePath(path: string): string {
  const slash = path.replace(/\\/g, '/');
  if (slash === '/' || slash === '') return '/';
  return slash.replace(/\/+$/, '') || '/';
}

function joinPath(base: string, child: string): string {
  if (!child) return normalizePath(base);
  if (child.startsWith('/') || /^[A-Za-z]:\//.test(child.replace(/\\/g, '/'))) return normalizePath(child);
  const left = normalizePath(base);
  if (left === '/') return normalizePath(`/${child}`);
  return normalizePath(`${left}/${child}`);
}

export interface RewriteUrlsOptions {
  /** Theme directory; relative urls resolve here and must stay inside it. */
  readonly base: string;
  /** Maps an absolute path under the theme directory to a loadable URL. */
  readonly assetUrl: (absPath: string) => string;
}

export interface RewriteUrlsResult {
  readonly css: string;
  readonly warnings: string[];
}

const REMOTE_URL = /^(?:https?:)?\/\//i;
// Raster formats only: they cannot embed a further url()/@import/href of their own. `image/svg+xml`
// (and anything else) is refused, because an SVG payload can reference a remote resource from
// inside itself and no check here ever sees it (MARXY-47's "nothing phones home" rule).
const INERT_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|avif)[;,]/i;

function isRemote(spec: string): boolean {
  const t = spec.trim();
  return REMOTE_URL.test(t) || /^https?:/i.test(t);
}

function resolvePath(themeRoot: string, rel: string): string | null {
  const joined = joinPath(themeRoot, rel);
  const parts = joined.replace(/\\/g, '/').split('/').filter((p) => p !== '');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
    } else if (part !== '.') stack.push(part);
  }
  const resolved = stack.length === 0 ? '/' : `/${stack.join('/')}`;
  const root = normalizePath(themeRoot);
  if (resolved === root) return resolved;
  if (resolved.startsWith(`${root}/`)) return resolved;
  return null;
}

/** A url( value that opens a quote and does not close it before the `)`: the engine reads a bad-string. */
function badString(inner: string): boolean {
  const t = inner.trim();
  const q = t[0];
  if (q !== '"' && q !== "'") return false;
  return !(t.length >= 2 && t.endsWith(q) && skipString(t, 0) === t.length);
}

function unquoteUrl(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

/**
 * Tokenises CSS and rewrites or removes url/import/image-set references that leave the theme or the network.
 *
 * Removing a reference joins the text on either side, which can splice a fresh `url(` together
 * (`urlurl()(https://x)`). Rather than guess every splice, the result is scanned again: a clean
 * output produces no warnings (a rewritten asset url is a plain path, an inert data: url is kept),
 * so any warning on the second pass means the first left a reference behind, and the theme fails
 * closed (F-16).
 */
export function rewriteUrls(css: string, opts: RewriteUrlsOptions): RewriteUrlsResult {
  const first = rewritePass(css, opts);
  if (first.css === '') return first;
  if (rewritePass(first.css, opts).warnings.length > 0) {
    return {
      css: '',
      warnings: [...first.warnings, 'theme joined a url() together after removing a reference; the theme was not loaded'],
    };
  }
  return first;
}

function rewritePass(css: string, opts: RewriteUrlsOptions): RewriteUrlsResult {
  const warnings: string[] = [];
  const out: string[] = [];
  const themeRoot = normalizePath(opts.base);

  // CSS matches `url(`, `@import` and `image-set(` in any case, and an identifier may be written
  // with escapes (`u\72l(`). A backslash outside a string or comment is therefore refused outright
  // rather than decoded: no hand scanner decodes every escape the way the engine does, and one that
  // guesses wrong lets a remote URL through (commitment #3). Themes have no need for escaped names.
  const at = (i: number, word: string) => css.slice(i, i + word.length).toLowerCase() === word;

  let i = 0;
  while (i < css.length) {
    const ch = css[i];

    if (ch === '\\') {
      warnings.push('theme uses a CSS escape outside a string; the theme was not loaded');
      return { css: '', warnings };
    }

    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) {
        out.push(css.slice(i));
        break;
      }
      out.push(css.slice(i, end + 2));
      i = end + 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const j = skipString(css, i);
      out.push(css.slice(i, j));
      i = j;
      continue;
    }

    if (at(i, '@import')) {
      const end = importEnd(css, i);
      const stmt = css.slice(i, end);
      warnings.push(`theme referenced an @import (${stmt.trim().slice(0, 60)}…); not loaded`);
      i = end;
      continue;
    }

    if (at(i, 'url(')) {
      const close = findParenClose(css, i + 4);
      if (close === -1) {
        warnings.push('theme has an unterminated url(); the rest of it was not loaded');
        break;
      }
      const inner = css.slice(i + 4, close);
      if (badString(inner)) {
        warnings.push('theme referenced a url() with an unterminated string; not loaded');
        i = close + 1;
        continue;
      }
      const spec = unquoteUrl(inner);
      const replacement = rewriteOneUrl(spec, opts, themeRoot, warnings);
      if (replacement === null) {
        i = close + 1;
        continue;
      }
      out.push(`url(${replacement})`);
      i = close + 1;
      continue;
    }

    if (at(i, 'image-set(')) {
      const close = findParenClose(css, i + 10);
      if (close === -1) {
        warnings.push('theme has an unterminated image-set(); the rest of it was not loaded');
        break;
      }
      const inner = css.slice(i + 10, close);
      const rewritten = rewriteImageSetInner(inner, opts, themeRoot, warnings);
      out.push(`image-set(${rewritten})`);
      i = close + 1;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return { css: out.join(''), warnings };
}

/**
 * End (exclusive) of the string starting at `start`. CSS ends a string at an unescaped newline
 * (a bad-string) without consuming it, so a quote left open on one line cannot swallow the rules
 * that follow; a backslash-newline continues the string.
 */
function skipString(css: string, start: number): number {
  const quote = css[start];
  let j = start + 1;
  while (j < css.length) {
    const c = css[j];
    if (c === '\\') {
      j += css[j + 1] === '\r' && css[j + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === '\n' || c === '\r' || c === '\f') return j;
    j += 1;
  }
  return css.length;
}

/** End (exclusive) of an @import statement: the next `;` outside a string, comment or url(). */
function importEnd(css: string, start: number): number {
  let j = start;
  while (j < css.length) {
    const c = css[j];
    if (c === '"' || c === "'") j = skipString(css, j);
    else if (c === '/' && css[j + 1] === '*') {
      const e = css.indexOf('*/', j + 2);
      j = e === -1 ? css.length : e + 2;
    } else if (c === '(') {
      const close = findParenClose(css, j + 1);
      j = close === -1 ? css.length : close + 1;
    } else if (c === '\\') j += 2;
    else if (c === ';') return j + 1;
    else j += 1;
  }
  return css.length;
}

function findParenClose(text: string, start: number): number {
  let depth = 1;
  let j = start;
  while (j < text.length && depth > 0) {
    const c = text[j];
    // Skip a string the way the engine's tokenizer does, so a parenthesis inside quotes does not
    // count and a line break ends the string (F-16).
    if (c === '"' || c === "'") {
      j = skipString(text, j);
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    j += 1;
  }
  return depth === 0 ? j - 1 : -1;
}

function rewriteOneUrl(
  spec: string,
  opts: RewriteUrlsOptions,
  themeRoot: string,
  warnings: string[],
): string | null {
  if (spec === '') {
    warnings.push('theme has an empty url(); not loaded');
    return null;
  }
  // A raw newline inside a url() value ends the string in the engine's tokenizer, which then closes
  // the url( at the next `)` and reads the rest as live CSS; this scanner counts parentheses and
  // would have swallowed that rest as part of the value (F-16). No real path or raster has one.
  if (/[\n\r\f]/.test(spec)) {
    warnings.push('theme referenced a url() containing a line break; not loaded');
    return null;
  }
  if (/^data:/i.test(spec)) {
    // Real base64 and percent-encoded rasters contain no quote, parenthesis or backslash.
    if (!INERT_DATA_URL.test(spec) || /["'()\\]/.test(spec)) {
      warnings.push('theme referenced a data: URL that could embed a remote reference; not loaded');
      return null;
    }
    return `"${spec.replace(/"/g, '\\"')}"`;
  }
  if (isRemote(spec)) {
    warnings.push(`theme referenced \`${spec}\`; not loaded`);
    return null;
  }
  const abs = resolvePath(themeRoot, spec);
  if (abs === null) {
    warnings.push(`theme referenced \`${spec}\`; not loaded`);
    return null;
  }
  const url = opts.assetUrl(abs);
  return `"${url.replace(/"/g, '\\"')}"`;
}

function rewriteImageSetInner(
  inner: string,
  opts: RewriteUrlsOptions,
  themeRoot: string,
  warnings: string[],
): string {
  const parts: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i += 1;
    if (i >= inner.length) break;

    if (inner.slice(i, i + 4).toLowerCase() === 'url(') {
      const close = findParenClose(inner, i + 4);
      if (close === -1) break;
      const rawInner = inner.slice(i + 4, close);
      const replacement = badString(rawInner)
        ? (warnings.push('theme referenced a url() with an unterminated string; not loaded'), null)
        : rewriteOneUrl(unquoteUrl(rawInner), opts, themeRoot, warnings);
      i = close + 1;
      // The descriptor belongs to this candidate: dropped with it, never glued onto the one before.
      const rest = inner.slice(i).match(/^\s*(\d+(?:\.\d+)?x|type\([^)]+\)|\d+dpi)/);
      if (rest) i += rest[0].length;
      if (replacement !== null) parts.push(`url(${replacement})${rest ? rest[0] : ''}`);
      continue;
    }

    const quote = inner[i];
    if (quote === '"' || quote === "'") {
      // Same string rules as the tokenizer: a line break ends the string unclosed.
      let j = skipString(inner, i);
      const closed = j - i >= 2 && inner[j - 1] === quote && /(?:^|[^\\])(?:\\\\)*$/.test(inner.slice(i + 1, j - 1));
      const spec = closed ? inner.slice(i + 1, j - 1) : inner.slice(i + 1, j);
      if (!closed) {
        warnings.push('theme referenced a url() with an unterminated string; not loaded');
      } else if (/[\n\r\f]/.test(spec)) {
        warnings.push('theme referenced a url() containing a line break; not loaded');
      } else if (isRemote(spec)) {
        warnings.push(`theme referenced \`${spec}\`; not loaded`);
      } else {
        const abs = resolvePath(themeRoot, spec);
        if (abs === null) {
          warnings.push(`theme referenced \`${spec}\`; not loaded`);
        } else {
          const url = opts.assetUrl(abs);
          let candidate = `"${url.replace(/"/g, '\\"')}"`;
          const tail = inner.slice(j).match(/^\s*(\d+(?:\.\d+)?x)/);
          if (tail) {
            candidate += ` ${tail[1]}`;
            j += tail[0].length;
          }
          parts.push(candidate);
        }
      }
      i = j;
      continue;
    }

    i += 1;
  }
  return parts.join(', ');
}
