// Lezer tags → the --marxy-tok-* custom properties. Source and Rendered read one role table
// (packages/core/src/highlight/roles.ts, ADR-0068) and one contrast-audited palette in both variants;
// `var(...)` makes the colours follow the variant live.

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags as t, type Tag } from '@lezer/highlight';
import { ROLES, type MarxyRole } from '@marxy/core/src/highlight/roles.ts';

const tok = (name: string): string => `var(--marxy-tok-${name})`;

type Modifier = (tag: Tag) => Tag;
const MODIFIERS: Record<string, Modifier> = {
  definition: t.definition,
  function: t.function,
  standard: t.standard,
  local: t.local,
  constant: t.constant,
  special: t.special,
};

/** Resolve a table entry such as `definition(function(variableName))` to the `@lezer/highlight` tag. */
export function lezerTag(spec: string): Tag {
  const m = /^(\w+)\((.+)\)$/.exec(spec);
  if (m) {
    const modifier = MODIFIERS[m[1]!];
    if (!modifier) throw new Error(`unknown tag modifier in role table: ${spec}`);
    return modifier(lezerTag(m[2]!));
  }
  const tag = (t as unknown as Record<string, unknown>)[spec];
  if (!tag || typeof tag === 'function') {
    // `name` is the tag for a name; it is a Tag like the others. A modifier used bare is a mistake.
    if (spec === 'name') return t.name;
    throw new Error(`unknown tag in role table: ${spec}`);
  }
  return tag as Tag;
}

/**
 * Painting order. Where one token carries two tags (a Rust attribute's name is `meta` and `variableName`),
 * both classes apply and the later rule wins, so the specific roles come after the general ones, and strings,
 * numbers and escapes come after `decorator` so a decorator's arguments keep their own colour.
 */
export const ROLE_ORDER: readonly MarxyRole[] = [
  'variable', 'punctuation', 'operator', 'keyword', 'property', 'type', 'function', 'builtin', 'self', 'tag', 'attribute',
  'decorator', 'constant', 'number', 'string', 'escape', 'comment', 'marker', 'link', 'mark', 'heading',
];

/**
 * Weight and slant carry structure where colour does not; sizes stay put so lines stay on the grid.
 * A tag takes only one rule, so a tag that carries weight carries its colour in the same rule.
 */
const FACE: Partial<Record<MarxyRole, Record<string, string>>> = {
  comment: { fontStyle: 'italic' },
};

/** Names being defined take weight as well as colour (the handbook's rule). JetBrains Mono keeps its advance at every weight. */
const DEFINITIONS: ReadonlySet<string> = new Set(['definition(function(variableName))', 'definition(className)', 'definition(typeName)']);
/** ATX levels are kept by weight, never by size, so every row stays one line box. */
const HEADING_WEIGHTS: ReadonlyArray<readonly [Tag, string]> = [
  [t.heading1, '800'], [t.heading2, '700'], [t.heading3, '650'], [t.heading4, '600'], [t.heading5, '600'], [t.heading6, '600'],
];

/** The style itself, exported so a test or another surface can reuse it. */
export const marxyHighlightStyle = HighlightStyle.define([
  ...ROLE_ORDER.flatMap((role) => {
    const specs = ROLES[role].lezer;
    const plain = specs.filter((spec) => !DEFINITIONS.has(spec));
    const defined = specs.filter((spec) => DEFINITIONS.has(spec));
    return [
      { tag: plain.map(lezerTag), color: tok(role), ...FACE[role] },
      ...(defined.length ? [{ tag: defined.map(lezerTag), color: tok(role), fontWeight: '600' }] : []),
    ];
  }),
  ...HEADING_WEIGHTS.map(([tag, fontWeight]) => ({ tag, color: tok('heading'), fontWeight })),
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
]);

export function marxyHighlighting(): Extension {
  return syntaxHighlighting(marxyHighlightStyle);
}
