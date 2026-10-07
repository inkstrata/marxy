// Lezer tags → the --marxy-tok-* custom properties (L-06). Source and Rendered code read one
// contrast-audited palette in both variants; `var(...)` makes the colours follow the variant live.

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';

const tok = (name: string): string => `var(--marxy-tok-${name})`;

/** The style itself, exported so a test or another surface can reuse it. */
export const marxyHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self], color: tok('keyword') },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.docString, t.monospace], color: tok('string') },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: tok('comment') },
  { tag: [t.number, t.integer, t.float], color: tok('number') },
  { tag: [t.bool, t.null, t.atom, t.constant(t.name), t.constant(t.variableName)], color: tok('constant') },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.link, t.url], color: tok('function') },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName)], color: tok('type') },
  { tag: [t.variableName, t.propertyName, t.definition(t.variableName), t.definition(t.propertyName), t.local(t.variableName)], color: tok('variable') },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator, t.updateOperator, t.definitionOperator], color: tok('operator') },
  { tag: [t.punctuation, t.separator, t.bracket, t.paren, t.squareBracket, t.brace, t.angleBracket, t.processingInstruction, t.meta], color: tok('punctuation') },
  { tag: t.tagName, color: tok('tag') },
  { tag: t.attributeName, color: tok('attribute') },
  // Weight and slant carry structure where colour does not; sizes stay put so lines stay on the grid.
  { tag: t.heading, fontWeight: 'bold' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
]);

export function marxyHighlighting(): Extension {
  return syntaxHighlighting(marxyHighlightStyle);
}
