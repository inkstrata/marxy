/**
 * The AST contract. FROZEN (ADR-0003). Changing anything here needs an ADR.
 *
 * Every node carries byte provenance: which file, and the half-open byte range [start, end)
 * in that file's UTF-8 bytes. Offsets are bytes, not code units, because operations splice
 * the file's bytes and the promise is that nothing outside the range changes.
 */

export interface Source {
  /** Absolute path, or a stable identifier for an untitled buffer. */
  readonly file: string;
  /** Byte offset of the first byte of this node's source. */
  readonly start: number;
  /** Byte offset one past the last byte of this node's source. */
  readonly end: number;
}

export type BlockType =
  | 'document' | 'heading' | 'paragraph' | 'blockquote' | 'list' | 'listItem' | 'codeBlock'
  | 'htmlBlock' | 'thematicBreak' | 'table' | 'tableRow' | 'tableCell' | 'mathBlock'
  | 'footnoteDefinition' | 'frontmatter';

export type InlineType =
  | 'text' | 'emphasis' | 'strong' | 'strikethrough' | 'code' | 'link' | 'image' | 'html'
  | 'softBreak' | 'hardBreak' | 'footnoteReference' | 'mathInline' | 'taskMarker';

export interface NodeBase {
  readonly type: BlockType | InlineType;
  readonly src: Source;
  readonly children?: readonly Node[];
}

export interface Document extends NodeBase { readonly type: 'document'; readonly children: readonly Block[]; readonly path: string; }
export interface Heading extends NodeBase { readonly type: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly children: readonly Inline[]; }
export interface Paragraph extends NodeBase { readonly type: 'paragraph'; readonly children: readonly Inline[]; }
export interface Blockquote extends NodeBase { readonly type: 'blockquote'; readonly children: readonly Block[]; }
export interface List extends NodeBase { readonly type: 'list'; readonly ordered: boolean; readonly start?: number; readonly tight: boolean; readonly children: readonly ListItem[]; }
export interface ListItem extends NodeBase { readonly type: 'listItem'; readonly task?: 'checked' | 'unchecked'; readonly children: readonly Block[]; }
export interface CodeBlock extends NodeBase { readonly type: 'codeBlock'; readonly lang?: string; readonly info?: string; readonly value: string; /** byte range of the content only, excluding the fence lines */ readonly content: Source; }
export interface HtmlBlock extends NodeBase { readonly type: 'htmlBlock'; readonly value: string; }
export interface ThematicBreak extends NodeBase { readonly type: 'thematicBreak'; }
export interface Table extends NodeBase { readonly type: 'table'; readonly align: readonly ('left' | 'center' | 'right' | null)[]; readonly children: readonly TableRow[]; }
export interface TableRow extends NodeBase { readonly type: 'tableRow'; readonly header: boolean; readonly children: readonly TableCell[]; }
export interface TableCell extends NodeBase { readonly type: 'tableCell'; readonly children: readonly Inline[]; }
export interface MathBlock extends NodeBase { readonly type: 'mathBlock'; readonly value: string; }
export interface FootnoteDefinition extends NodeBase { readonly type: 'footnoteDefinition'; readonly label: string; readonly children: readonly Block[]; }
export interface Frontmatter extends NodeBase { readonly type: 'frontmatter'; readonly value: string; }

export type Block = Heading | Paragraph | Blockquote | List | ListItem | CodeBlock | HtmlBlock | ThematicBreak | Table | TableRow | TableCell | MathBlock | FootnoteDefinition | Frontmatter;

export interface Text extends NodeBase { readonly type: 'text'; readonly value: string; }
export interface Emphasis extends NodeBase { readonly type: 'emphasis'; readonly children: readonly Inline[]; }
export interface Strong extends NodeBase { readonly type: 'strong'; readonly children: readonly Inline[]; }
export interface Strikethrough extends NodeBase { readonly type: 'strikethrough'; readonly children: readonly Inline[]; }
export interface InlineCode extends NodeBase { readonly type: 'code'; readonly value: string; }
export interface Link extends NodeBase { readonly type: 'link'; readonly url: string; readonly title?: string; readonly children: readonly Inline[]; }
export interface Image extends NodeBase { readonly type: 'image'; readonly url: string; readonly alt: string; readonly title?: string; }
export interface InlineHtml extends NodeBase { readonly type: 'html'; readonly value: string; }
export interface SoftBreak extends NodeBase { readonly type: 'softBreak'; }
export interface HardBreak extends NodeBase { readonly type: 'hardBreak'; }
export interface FootnoteReference extends NodeBase { readonly type: 'footnoteReference'; readonly label: string; }
export interface MathInline extends NodeBase { readonly type: 'mathInline'; readonly value: string; }
/** The `[ ]` / `[x]` marker of a task item; its own node so toggling is a splice of exactly these bytes. */
export interface TaskMarker extends NodeBase { readonly type: 'taskMarker'; readonly checked: boolean; }

export type Inline = Text | Emphasis | Strong | Strikethrough | InlineCode | Link | Image | InlineHtml | SoftBreak | HardBreak | FootnoteReference | MathInline | TaskMarker;
export type Node = Document | Block | Inline;

/** Invariants every parser output must satisfy; asserted by golden tests. */
export const AST_INVARIANTS = [
  'src.start <= src.end for every node',
  'a child range is contained in its parent range',
  'sibling ranges are ordered and non-overlapping',
  'document.src covers [0, byteLength)',
  'codeBlock.content is contained in codeBlock.src and excludes the fence lines',
  'decoding file bytes [src.start, src.end) of a text node yields its value modulo escapes',
] as const;
