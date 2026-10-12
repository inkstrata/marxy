// The one role table (V-13, ADR-0068). Each syntax role names the Lezer tags that colour it in Source and the
// TextMate scopes that colour it in Rendered, so one token gets one role in both modes. Source builds its
// HighlightStyle from `lezer` (apps/desktop/src/source/highlight-style.ts); Rendered builds its Shiki theme and
// scope lookup from `textmate` (scopes.ts). core takes no @lezer dependency, so tags are written as the names
// `@lezer/highlight` exports: `name`, or `modifier(name)` nested to any depth.

/** Every role the default theme gives a hue. `heading`, `marker`, `link` and `mark` are Source-only (Rendered sets headings as type). */
export type MarxyRole =
  | 'comment'
  | 'string'
  | 'escape'
  | 'number'
  | 'constant'
  | 'keyword'
  | 'operator'
  | 'function'
  | 'builtin'
  | 'type'
  | 'property'
  | 'decorator'
  | 'self'
  | 'tag'
  | 'attribute'
  | 'variable'
  | 'punctuation'
  | 'heading'
  | 'marker'
  | 'link'
  | 'mark';

export interface RoleSpec {
  /** Lezer tags (Source). */
  readonly lezer: readonly string[];
  /**
   * TextMate scope prefixes (Rendered). The longest matching prefix wins, so `keyword.operator` beats `keyword`.
   * An entry with a space is a contextual selector (`ancestor descendant`), which a TextMate theme honours.
   */
  readonly textmate: readonly string[];
}

export const ROLES: Readonly<Record<MarxyRole, RoleSpec>> = {
  comment: { lezer: ['comment', 'lineComment', 'blockComment', 'docComment'], // A comment's own marker (`#`, `//`) and a string's quotes are punctuation to TextMate and part of the comment or string to Lezer.
    textmate: ['comment', 'punctuation.definition.comment'] },
  string: {
    lezer: ['string', 'special(string)', 'regexp', 'character', 'docString', 'attributeValue', 'monospace', 'url'],
    textmate: ['string', 'storage.type.string', 'punctuation.definition.string'],
  },
  escape: {
    lezer: ['escape'],
    textmate: ['constant.character.escape', 'constant.other.placeholder'],
  },
  number: { lezer: ['number', 'integer', 'float'], textmate: ['constant.numeric'] },
  constant: {
    lezer: ['bool', 'null', 'atom', 'constant(name)', 'constant(variableName)'],
    textmate: ['constant', 'support.constant'],
  },
  keyword: {
    lezer: ['keyword', 'controlKeyword', 'definitionKeyword', 'moduleKeyword', 'operatorKeyword', 'modifier'],
    // `storage` is the TextMate word for `class`, `def`, `const`, `let`; Lezer calls them keywords.
    textmate: ['keyword', 'storage'],
  },
  operator: {
    lezer: ['operator', 'compareOperator', 'logicOperator', 'arithmeticOperator', 'updateOperator', 'definitionOperator'],
    textmate: ['keyword.operator'],
  },
  function: {
    lezer: ['function(variableName)', 'function(propertyName)', 'definition(function(variableName))', 'macroName'],
    textmate: ['entity.name.function', 'meta.function-call.generic'],
  },
  builtin: {
    lezer: ['standard(variableName)', 'standard(typeName)', 'standard(propertyName)'],
    textmate: [
      'support.function',
      'support.type',
      'support.class',
      'entity.name.function.support.builtin',
      'storage.type.built-in',
      'storage.type.primitive',
      'storage.type.numeric',
      'storage.type.string.go',
    ],
  },
  type: {
    lezer: ['typeName', 'className', 'namespace', 'definition(className)', 'definition(typeName)'],
    textmate: ['entity.name.type', 'entity.name.class', 'entity.other.inherited-class'],
  },
  property: {
    lezer: ['propertyName', 'definition(propertyName)', 'local(propertyName)'],
    textmate: [
      'variable.other.property',
      'variable.other.object.property',
      'variable.object.property',
      'variable.other.member',
      'support.variable.property',
      'meta.object-literal.key',
      'meta.attribute.python',
    ],
  },
  decorator: {
    // Lezer has no decorator tag. `meta` is what the Python, JS and Rust grammars give an annotation, and
    // source/language.ts tags a decorator's whole node as `meta` where the grammar nests it.
    lezer: ['meta'],
    textmate: [
      'entity.name.function.decorator',
      'punctuation.definition.decorator',
      'punctuation.decorator',
      'meta.decorator.ts entity.name.function',
      'meta.decorator.tsx entity.name.function',
      'meta.decorator.js entity.name.function',
      'meta.attribute.rust',
      'punctuation.definition.attribute.rust',
      'punctuation.brackets.attribute.rust',
    ],
  },
  self: {
    lezer: ['self'],
    textmate: [
      'variable.language',
      'variable.parameter.function.language.special.self',
      'variable.parameter.function.language.special.cls',
    ],
  },
  tag: { lezer: ['tagName'], textmate: ['entity.name.tag'] },
  attribute: { lezer: ['attributeName'], textmate: ['entity.other.attribute-name'] },
  variable: {
    lezer: ['variableName', 'definition(variableName)', 'local(variableName)', 'labelName'],
    textmate: ['variable', 'support.variable'],
  },
  punctuation: {
    lezer: ['punctuation', 'separator', 'bracket', 'paren', 'squareBracket', 'brace', 'angleBracket', 'derefOperator'],
    textmate: ['punctuation', 'constant.character.format.placeholder'],
  },
  // Source-only roles (Markdown): Rendered sets headings as type and draws no marks.
  heading: { lezer: ['heading'], textmate: [] },
  marker: { lezer: ['processingInstruction'], textmate: [] },
  link: { lezer: ['link'], textmate: [] },
  // `contentSeparator` is the rule's own tag; source/language.ts also gives it to quote marks, list marks and task boxes.
  mark: { lezer: ['contentSeparator'], textmate: [] },
};

/** Roles Rendered paints, in a fixed order that the internal Shiki theme's pseudo-colours encode. */
export const RENDERED_ROLES = (Object.keys(ROLES) as MarxyRole[]).filter((r) => ROLES[r].textmate.length > 0);
