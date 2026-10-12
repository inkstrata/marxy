// Maps TextMate scopes to the marxy token classes and builds the internal Shiki theme (MARXY-27, V-13).
// The scope lists live in the one role table (roles.ts, ADR-0068), shared with Source's Lezer style.
import { normalizeTheme, type ThemeRegistration } from '@shikijs/core';
import { RENDERED_ROLES, ROLES, type MarxyRole } from './roles.ts';

/** The syntax classes the renderer may paint: every role that has TextMate scopes (docs/design/02-render.md §Code highlighting). */
export type MarxyTokenScope = Extract<
  MarxyRole,
  | 'comment' | 'string' | 'escape' | 'number' | 'constant' | 'keyword' | 'operator' | 'function' | 'builtin' | 'type'
  | 'property' | 'decorator' | 'self' | 'tag' | 'attribute' | 'variable' | 'punctuation'
>;

const SCOPES = RENDERED_ROLES as readonly MarxyTokenScope[];

/** Unique colours encode the winning class; Shiki does not expose scopes on tokens in v4. */
const CLASS_COLOR = new Map<MarxyTokenScope, string>(
  SCOPES.map((scope, index) => [scope, '#' + String(index + 1).padStart(6, '0')]),
);
const COLOR_CLASS = new Map([...CLASS_COLOR.entries()].map(([scope, color]) => [color.toUpperCase(), scope]));

export const INTERNAL_THEME_NAME = 'marxy-scopes';

export function internalScopeTheme(): ThemeRegistration {
  const settings = [
    ...SCOPES.map((scope) => ({
      // A plain prefix covers its children (`prefix`, `prefix.*`); a contextual selector (`a b`) is one entry.
      scope: ROLES[scope].textmate.flatMap((prefix) => (prefix.includes(' ') ? [prefix] : [prefix, prefix + '.*'])),
      settings: { foreground: CLASS_COLOR.get(scope) },
    })),
    { settings: { foreground: '#999999' } },
  ];
  return normalizeTheme({ name: INTERNAL_THEME_NAME, type: 'dark', settings });
}

/** Every plain prefix with its role, longest first, so the most specific one is found first. */
const PREFIXES = SCOPES.flatMap((scope) =>
  ROLES[scope].textmate.filter((p) => !p.includes(' ')).map((prefix) => ({ scope, prefix })),
).sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * `markup.inserted` and `markup.deleted` intentionally map to no token hue; diff lines use
 * `marxy-diff-add` / `marxy-diff-del` on `.marxy-line` instead (MARXY-235, ADR-0036).
 * The most specific (longest) prefix wins, as in a TextMate theme.
 */
export function marxyScopeForTextMateScope(scope: string): MarxyTokenScope | undefined {
  if (scope.startsWith('markup.inserted') || scope.startsWith('markup.deleted')) return undefined;
  for (const { scope: role, prefix } of PREFIXES) {
    if (scope === prefix || scope.startsWith(prefix + '.')) return role;
  }
  return undefined;
}

export function marxyScopeForTokenColor(color: string | undefined): MarxyTokenScope | undefined {
  if (!color) return undefined;
  const normalized = color.startsWith('#') ? color.toUpperCase() : ('#' + color).toUpperCase();
  return COLOR_CLASS.get(normalized);
}
