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

function unquoteUrl(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

/** Tokenises CSS and rewrites or removes url/import/image-set references that leave the theme or the network. */
export function rewriteUrls(css: string, opts: RewriteUrlsOptions): RewriteUrlsResult {
  const warnings: string[] = [];
  const out: string[] = [];
  const themeRoot = normalizePath(opts.base);

  let i = 0;
  while (i < css.length) {
    const ch = css[i];

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
      const quote = ch;
      let j = i + 1;
      while (j < css.length) {
        if (css[j] === '\\') {
          j += 2;
          continue;
        }
        if (css[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out.push(css.slice(i, j));
      i = j;
      continue;
    }

    if (css.startsWith('@import', i)) {
      const semi = css.indexOf(';', i);
      const end = semi === -1 ? css.length : semi + 1;
      const stmt = css.slice(i, end);
      warnings.push(`theme referenced an @import (${stmt.trim().slice(0, 60)}…); not loaded`);
      i = end;
      continue;
    }

    if (css.startsWith('url(', i)) {
      const close = findParenClose(css, i + 4);
      if (close === -1) {
        out.push(css.slice(i));
        break;
      }
      const inner = css.slice(i + 4, close);
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

    if (css.startsWith('image-set(', i)) {
      const close = findParenClose(css, i + 10);
      if (close === -1) {
        out.push(css.slice(i));
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

function findParenClose(text: string, start: number): number {
  let depth = 1;
  let j = start;
  while (j < text.length && depth > 0) {
    const c = text[j];
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
  if (spec === '') return null;
  if (spec.startsWith('data:')) return `"${spec.replace(/"/g, '\\"')}"`;
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

    if (inner.startsWith('url(', i)) {
      const close = findParenClose(inner, i + 4);
      if (close === -1) break;
      const spec = unquoteUrl(inner.slice(i + 4, close));
      const replacement = rewriteOneUrl(spec, opts, themeRoot, warnings);
      if (replacement !== null) parts.push(`url(${replacement})`);
      i = close + 1;
      const rest = inner.slice(i).match(/^\s*(\d+(?:\.\d+)?x|type\([^)]+\)|\d+dpi)/);
      if (rest) {
        parts[parts.length - 1] += rest[0];
        i += rest[0].length;
      }
      continue;
    }

    const quote = inner[i];
    if (quote === '"' || quote === "'") {
      let j = i + 1;
      while (j < inner.length && inner[j] !== quote) j += 1;
      const spec = inner.slice(i + 1, j);
      j += 1;
      if (isRemote(spec)) {
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
