// Module specifiers, raw `invoke(` calls and comment stripping, read from the TypeScript AST rather
// than regexes. The gates that enforce module boundaries (check-boundaries, gate-bundle) and the
// registry gate used to scan text, and every regex missed something: multi-line import lists,
// side-effect imports, two imports on one line, `//` inside a string. Parsing is the honest answer.
import ts from 'typescript';
import { builtinModules } from 'node:module';

const kindFor = fileName => (/\.[mc]?tsx$/.test(fileName) ? ts.ScriptKind.TSX
  : /\.[mc]?jsx$/.test(fileName) ? ts.ScriptKind.JSX
    : /\.[mc]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

function parse(text, fileName = 'file.ts') {
  return ts.createSourceFile(fileName, String(text ?? ''), ts.ScriptTarget.Latest, true, kindFor(fileName));
}

const isStringy = n => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));

/**
 * Every module specifier in a source text, in source order, as `{ spec, kind }` where kind is
 * `static` (import/export … from, `import 'x'`, `import x = require('x')`, `import('x')` types),
 * `dynamic` (`import('x')`) or `require`. An interpolated template (`import(\`./${x}\`)`) cannot be
 * resolved statically and is not returned.
 */
export function importSpecEntries(text, fileName = 'file.ts') {
  const out = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isStringy(node.moduleSpecifier)) {
      out.push({ spec: node.moduleSpecifier.text, kind: 'static' });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && isStringy(node.moduleReference.expression)) {
      out.push({ spec: node.moduleReference.expression.text, kind: 'static' });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && isStringy(node.argument.literal)) {
      out.push({ spec: node.argument.literal.text, kind: 'static' });
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && isStringy(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) out.push({ spec: node.arguments[0].text, kind: 'dynamic' });
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') out.push({ spec: node.arguments[0].text, kind: 'require' });
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text, fileName));
  return out;
}

/** Just the specifier strings, static and dynamic alike. */
export const importSpecs = (text, fileName) => importSpecEntries(text, fileName).map(e => e.spec);

/** Only `import()` and `require()` specifiers. */
export const dynamicImportSpecs = (text, fileName) => importSpecEntries(text, fileName).filter(e => e.kind !== 'static').map(e => e.spec);

/** Calls to a function named `invoke` (`invoke(x)`, `invoke<T>(x)`, `core.invoke(x)`), by AST. */
export function rawInvokeCalls(text, fileName = 'file.ts') {
  let n = 0;
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      if ((ts.isIdentifier(e) && e.text === 'invoke') || (ts.isPropertyAccessExpression(e) && e.name.text === 'invoke')) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text, fileName));
  return n;
}

/** Whether a specifier names a Node built-in, with or without `node:` and including subpaths. */
export const isNodeBuiltin = spec => /^node:/.test(spec) || builtinModules.includes(spec);

/**
 * The text with every comment blanked to spaces (newlines kept), leaving strings, templates and
 * regex literals alone. Comments live only in the trivia before a token, so the trivia of each token
 * is the only place to look; `/*` inside a string is a token, never trivia.
 */
export function stripCommentsAst(text, fileName = 'file.ts') {
  const src = String(text ?? '');
  const sf = parse(src, fileName);
  const ranges = [];
  const visit = node => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const kids = node.getChildren(sf);
    if (kids.length === 0) {
      const from = node.getFullStart(); const to = node.getStart(sf);
      if (to > from) ranges.push([from, to]);
      return;
    }
    kids.forEach(visit);
  };
  visit(sf);
  // UTF-16 units, like the offsets TypeScript reports: spreading by code point would shift every
  // blanked range after an astral character (an emoji) onto real code.
  const chars = src.split('');
  for (const [from, to] of ranges) {
    const trivia = src.slice(from, to);
    for (const m of trivia.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
      for (let i = m.index; i < m.index + m[0].length; i++) if (chars[from + i] !== '\n') chars[from + i] = ' ';
    }
  }
  return chars.join('');
}
