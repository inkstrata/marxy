// The URL decision (ADR-0009). Made by resolving the value with the URL parser and inspecting the
// result, never by scanning the string for a scheme: `/\host`, `\\host`, `//host` and `http:\\host`
// are the same attack written four ways, and only a parser is guaranteed to read them the way the
// browser will.

import { decodeReferences } from './escape.ts';
import { RESOLUTION_BASES } from './document-origin.ts';
import type { Policy, UrlContext } from './policy.ts';

export interface UrlDecision {
  readonly allowed: boolean;
  /** The value to emit: the parsed form when it is absolute, the cleaned reference when it is local. */
  readonly value: string;
  /** How the value reads under the strictest base (see `document-origin.ts`); for the record. */
  readonly resolved?: string;
  /** Whether the value addresses an authority of its own rather than the document's. */
  readonly absolute?: boolean;
  /** Lowercase scheme when the value is absolute; present on refusals so callers need not re-parse. */
  readonly scheme?: string;
  /** Why it was refused, for the notice that will read the removal report (MARXY-26, MARXY-44). */
  readonly reason?: string;
}

/** Removed anywhere in a URL by every parser, which is why `java&#9;script:` is `javascript:`. */
const TAB_OR_NEWLINE = /[\t\n\r]/g;
/** Stripped from both ends by every parser, NUL included. */
const SURROUNDING_C0 = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;
/** What is left may not contain a control character: it would be encoded, and we would be guessing. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function sanitizeUrl(raw: string, context: UrlContext, policy: Policy): UrlDecision {
  const value = decodeReferences(raw).replace(TAB_OR_NEWLINE, '').replace(SURROUNDING_C0, '');
  if (value === '') return { allowed: false, value: '', reason: 'empty' };
  if (CONTROL.test(value)) {
    return { allowed: false, value, reason: 'a control character inside the reference' };
  }

  const [first, second, third] = RESOLUTION_BASES;
  let here: URL;
  let elsewhere: URL;
  let otherScheme: URL;
  try {
    here = new URL(value, first);
    elsewhere = new URL(value, second);
    otherScheme = new URL(value, third);
  } catch {
    return { allowed: false, value, reason: 'the URL parser refused it, so nothing here can be sure what it means' };
  }

  // A relative reference inherits its base, so it differs between two hosts; an absolute one does not.
  const absolute = here.href === elsewhere.href;
  if (!absolute) return { allowed: true, value, resolved: here.href, absolute: false };

  if (here.protocol !== otherScheme.protocol) {
    return {
      allowed: false, value, resolved: here.href, absolute: true,
      reason: 'a scheme-relative reference addresses a host under whatever scheme the document was loaded with, which is not ours to guess',
    };
  }

  const scheme = here.protocol.slice(0, -1).toLowerCase();
  if (!policy.urlSchemes[context].includes(scheme)) {
    return {
      allowed: false, value: here.href, resolved: here.href, absolute: true, scheme,
      reason: `scheme ${scheme}: is not allowed in a ${context}`,
    };
  }
  // Emitted in its parsed form: what the browser will actually use, with the host in its canonical
  // spelling, so a confusable or punycoded host cannot read as one thing here and another there.
  return { allowed: true, value: here.href, resolved: here.href, absolute: true };
}
