// Maps TextMate scopes to the twelve marxy token classes and builds the internal Shiki theme (MARXY-27).
import { normalizeTheme, type ThemeRegistration } from '@shikijs/core';

/** The twelve syntax classes the renderer may paint (docs/design/02-render.md §Code highlighting). */
export type MarxyTokenScope =
  | 'comment'
  | 'string'
  | 'number'
  | 'constant'
  | 'keyword'
  | 'operator'
  | 'function'
  | 'type'
  | 'tag'
  | 'attribute'
  | 'variable'
  | 'punctuation';

/** Prefix order is fixed in the design; first match wins. */
const RULES: readonly { scope: MarxyTokenScope; prefixes: readonly string[] }[] = [
  { scope: 'comment', prefixes: ['comment'] },
  { scope: 'string', prefixes: ['string'] },
  { scope: 'number', prefixes: ['constant.numeric'] },
  { scope: 'constant', prefixes: ['constant'] },
  {
    scope: 'keyword',
    prefixes: ['keyword.control', 'keyword.other', 'storage.modifier', 'keyword'],
  },
  { scope: 'operator', prefixes: ['keyword.operator'] },
  { scope: 'function', prefixes: ['entity.name.function', 'support.function', 'meta.function-call'] },
  {
    scope: 'type',
    prefixes: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'storage.type'],
  },
  { scope: 'tag', prefixes: ['entity.name.tag'] },
  { scope: 'attribute', prefixes: ['entity.other.attribute-name'] },
  { scope: 'variable', prefixes: ['variable', 'support.variable'] },
  { scope: 'punctuation', prefixes: ['punctuation'] },
];

/** Unique colours encode the winning class; Shiki does not expose scopes on tokens in v4. */
const CLASS_COLOR = new Map<MarxyTokenScope, string>(
  RULES.map((rule, index) => [rule.scope, '#' + String(index + 1).padStart(6, '0')]),
);
const COLOR_CLASS = new Map([...CLASS_COLOR.entries()].map(([scope, color]) => [color.toUpperCase(), scope]));

export const INTERNAL_THEME_NAME = 'marxy-scopes';

const THEME_SETTING_ORDER: readonly MarxyTokenScope[] = [
  'comment',
  'string',
  'number',
  'constant',
  'operator',
  'keyword',
  'function',
  'type',
  'tag',
  'attribute',
  'variable',
  'punctuation',
];

export function internalScopeTheme(): ThemeRegistration {
  const byScope = new Map(RULES.map((rule) => [rule.scope, rule]));
  const settings = [
    ...THEME_SETTING_ORDER.map((scope) => {
      const rule = byScope.get(scope)!;
      return {
        scope: rule.prefixes.flatMap((prefix) => [prefix, prefix + '.*']),
        settings: { foreground: CLASS_COLOR.get(scope) },
      };
    }),
    { settings: { foreground: '#999999' } },
  ];
  return normalizeTheme({ name: INTERNAL_THEME_NAME, type: 'dark', settings });
}

/** First matching prefix in design order; keyword does not match keyword.operator. */
export function marxyScopeForTextMateScope(scope: string): MarxyTokenScope | undefined {
  for (const rule of RULES) {
    for (const prefix of rule.prefixes) {
      if (scope === prefix || scope.startsWith(prefix + '.')) {
        if (rule.scope === 'keyword' && scope.startsWith('keyword.operator')) continue;
        if (rule.scope === 'constant' && scope.startsWith('constant.numeric')) continue;
        return rule.scope;
      }
    }
  }
  return undefined;
}

export function marxyScopeForTokenColor(color: string | undefined): MarxyTokenScope | undefined {
  if (!color) return undefined;
  const normalized = color.startsWith('#') ? color.toUpperCase() : ('#' + color).toUpperCase();
  return COLOR_CLASS.get(normalized);
}
