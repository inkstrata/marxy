// Transitive `@codemirror/language` (via lang-* packages); folding imports only (MARXY-239).
declare module '@codemirror/language' {
  import type { Extension } from '@codemirror/state';
  export function codeFolding(config?: { placeholderDOM?: () => Node }): Extension;
  export function foldGutter(): Extension;
}
