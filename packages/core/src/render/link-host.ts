// Link text vs destination host comparison and mismatch labels (handbook ch.7, MARXY-236).

import { hostnameToUnicode } from './punycode.ts';

export interface HostForms {
  readonly punycode: string;
  readonly unicode: string;
}

export interface LinkHostLabel {
  /** Shown after link text when hosts differ (e.g. `b.com` or `xn--… (аpple.com)`). */
  readonly text: string;
}

function urlFromLike(raw: string): URL | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function hostFromUrlLike(raw: string): string | null {
  const url = urlFromLike(raw);
  return url === null ? null : url.hostname.toLowerCase();
}

/** The destination as a web URL with a hostname; mailto:, relative paths and fragments are not. */
function webDestination(href: string): URL | null {
  try {
    const url = new URL(href.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname === '' ? null : url;
  } catch {
    return null;
  }
}

const FILE_LIKE_TLD =
  /^(?:md|markdown|txt|pdf|png|jpe?g|gif|svg|rs|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|css|html?|wasm|lock)$/i;

/** True when link text looks like a URL or dotted hostname (not a filename or version). */
export function linkTextLooksLikeHost(text: string): boolean {
  const t = text.trim();
  if (t === '') return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (!t.includes('.') || /\s/.test(t)) return false;
  const host = hostFromUrlLike(t);
  if (host === null) return false;
  const labels = host.split('.');
  const tld = labels[labels.length - 1] ?? '';
  if (FILE_LIKE_TLD.test(tld)) return false;
  if (labels.every((label) => /^[0-9]+$/.test(label))) return false;
  return labels.length >= 2;
}

export function hostForms(hostname: string): HostForms {
  const punycode = hostname.toLowerCase();
  const unicode = hostnameToUnicode(punycode);
  return { punycode, unicode };
}

function displayHost(forms: HostForms): string {
  if (forms.punycode === forms.unicode) return forms.punycode;
  if (forms.punycode.includes('xn--')) return `${forms.punycode} (${forms.unicode})`;
  return `${forms.unicode} (${forms.punycode})`;
}

function destIsConfusable(destHost: string): boolean {
  return destHost.includes('xn--') || hostForms(destHost).punycode !== hostForms(destHost).unicode;
}

/** Label when visible link text names a different or confusable host than `href`. */
export function linkHostMismatchLabel(linkText: string, href: string): LinkHostLabel | null {
  if (!linkTextLooksLikeHost(linkText)) return null;
  const textUrl = urlFromLike(linkText);
  const dest = webDestination(href);
  if (textUrl === null || dest === null) return null;
  const textHost = textUrl.hostname.toLowerCase();
  const destHost = dest.hostname.toLowerCase();
  // `https://paypal.com@evil.com` reads as paypal.com but goes to evil.com: the visible userinfo is the tell.
  // A plain address (`user@example.com`) is not: userinfo only deceives with a scheme, a password, or a
  // user part that itself looks like a host.
  const deceptive =
    textUrl.password !== '' ||
    (textUrl.username !== '' && (/^[a-z][a-z0-9+.-]*:\/\//i.test(linkText.trim()) || textUrl.username.includes('.')));
  if (textHost === destHost && textUrl.port === dest.port && !deceptive && !destIsConfusable(destHost)) return null;
  return { text: displayHost(hostForms(destHost)) };
}

/** Destination line for summon (focus/hover); always the destination host forms. Null for non-web destinations. */
export function linkDestinationLabel(href: string): string | null {
  const dest = webDestination(href);
  if (dest === null) return null;
  return displayHost(hostForms(dest.hostname.toLowerCase()));
}
