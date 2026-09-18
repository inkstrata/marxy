// The URL decision (ADR-0009). Two questions only: does this value carry a scheme, and is that
// scheme allow-listed for the place it appears in. Everything else — a relative path, a fragment —
// is local and cannot reach the network; everything undecidable is refused.

import { decodeReferences } from './escape.ts';
import type { Policy, UrlContext } from './policy.ts';

export interface UrlDecision {
  readonly allowed: boolean;
  /** The decoded, noise-stripped value to emit. Only meaningful when `allowed`. */
  readonly value: string;
  /** Why it was refused, for the removal report a notice will read (MARXY-26, MARXY-44). */
  readonly reason?: string;
}

/** ASCII whitespace and C0/C1 controls, which a URL parser strips before it looks at the scheme. */
const NOISE = /[\u0000-\u0020\u007f-\u009f]/g;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
/**
 * The part of a value that decides what it addresses: everything before the first `/`, `?` or `#`.
 * A query may legitimately contain `&`; the head may not, because an `&` there means the value
 * still holds something reference-shaped and we would be judging a form the parser will not see.
 */
const UNSAFE_IN_HEAD = /[&\\<>"'`\u0000-\u0020]/;

export function sanitizeUrl(raw: string, context: UrlContext, policy: Policy): UrlDecision {
  const value = decodeReferences(raw).replace(NOISE, '');
  if (value === '') return { allowed: false, value: '', reason: 'empty' };

  const head = value.split(/[/?#]/, 1)[0] ?? '';
  if (UNSAFE_IN_HEAD.test(head)) {
    return { allowed: false, value, reason: 'the part that decides the scheme is not decodable safely' };
  }

  const scheme = SCHEME.exec(head)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    return policy.urlSchemes[context].includes(scheme)
      ? { allowed: true, value }
      : { allowed: false, value, reason: `scheme ${scheme}: not allowed in a ${context}` };
  }

  // `//host/path` inherits the page's scheme, which makes it remote without naming one.
  if (value.startsWith('//')) {
    return { allowed: false, value, reason: `scheme-relative reference is remote in a ${context}` };
  }

  return { allowed: true, value };
}
