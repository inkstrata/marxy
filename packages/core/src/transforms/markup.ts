// Markdown to Slack mrkdwn and to Jira wiki (J-03.1). Both walk the AST the parser made, never the text with regexes,
// so a `*` inside a code span or a `|` in a table cell is read for what it is. The two share one walker; a `Dialect`
// says how each construct is written. Pure: no DOM, no Node built-ins. Linear: each node is visited once and every
// string is built from arrays joined once.
import type { Block, Inline, List, ListItem, Node, Table } from '../contracts/ast.ts';
import { cellGrid } from '../operations/table-cells.ts';
import { displayWidth } from '../operations/display-width.ts';
import { parseText } from './prose.ts';
import type { TransformDef } from './types.ts';

/** A callout's kind: `> [!NOTE]` on the first line of a quote. */
const CALLOUT = /^\[!([A-Za-z]+)\][ \t]*/;

interface Dialect {
  text(s: string, inTable: boolean): string;
  strong(s: string): string;
  emphasis(s: string): string;
  strike(s: string): string;
  code(s: string, inTable: boolean): string;
  /** Inline HTML: the tags have no equivalent, so Slack shows them as text and Jira drops them (the text between them stays). */
  inlineHtml(value: string): string;
  link(label: string, url: string): string;
  image(alt: string, url: string): string;
  heading(level: number, s: string): string;
  quote(body: string): string;
  callout(kind: string, body: string): string;
  codeBlock(value: string, lang?: string): string;
  thematicBreak: string;
  table(node: Table, cell: (cell: Inline[]) => string): string;
  /** The marker of one list item, given what the lists around it contribute (`outer`). */
  bullet(list: List, item: ListItem, index: number, outer: string): string;
  /** What a list's own items contribute to the lists nested inside them. */
  nest(list: List, outer: string): string;
  /** An item's body: its lines after the first sit under the marker (Slack) or are joined by a line break (Jira). */
  body(marker: string, body: string): string;
  /** Text for a raw HTML or math node, which the target has no equivalent of. */
  raw(value: string): string;
}

const lines = (s: string): string[] => s.split('\n');
const prefixed = (s: string, p: string): string => lines(s).map((l) => (l === '' ? p.trimEnd() : p + l)).join('\n');

// ---------------------------------------------------------------------------------------------------------------
// Slack mrkdwn. Slack has no headings, tables or rules: a heading is a bold line, a table is a code block of padded
// columns, a rule is a line of dashes.

const SLACK: Dialect = {
  text: (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  strong: (s) => `*${s}*`,
  emphasis: (s) => `_${s}_`,
  strike: (s) => `~${s}~`,
  code: (s) => `\`${s.replace(/`/g, "'")}\``,
  inlineHtml: (value) => SLACK.text(value, false),
  link: (label, url) => `<${url.replace(/[<>|]/g, encodeURIComponent)}|${label}>`,
  image: (alt, url) => `<${url.replace(/[<>|]/g, encodeURIComponent)}|${alt || 'image'}>`,
  heading: (_level, s) => `*${s}*`,
  quote: (body) => prefixed(body, '> '),
  callout: (kind, body) => prefixed(`*${kind}*${body === '' ? '' : `\n${body}`}`, '> '),
  codeBlock: (value) => `\`\`\`\n${value.replace(/```/g, "'''")}\n\`\`\``,
  thematicBreak: '---',
  table(node) {
    const grid = cellGrid(node);
    const widths = grid[0]?.map((_, c) => grid.reduce((m, r) => Math.max(m, displayWidth(r[c] ?? '')), 0)) ?? [];
    const rows = grid.map((r) => r.map((c, i) => c + ' '.repeat(widths[i]! - displayWidth(c))).join('  ').trimEnd());
    return `\`\`\`\n${rows.join('\n').replace(/```/g, "'''")}\n\`\`\``;
  },
  bullet(list, item, index, outer) {
    const task = item.task === 'checked' ? '[x] ' : item.task === 'unchecked' ? '[ ] ' : '';
    return `${outer}${list.ordered ? `${(list.start ?? 1) + index}.` : '•'} ${task}`;
  },
  nest: (_list, outer) => `${outer}  `,
  body(marker, body) {
    const [head, ...rest] = lines(body);
    return [head, ...rest.map((l) => (l === '' ? '' : ' '.repeat(marker.length) + l))].join('\n');
  },
  raw: (value) => SLACK.text(value, false),
};

// ---------------------------------------------------------------------------------------------------------------
// Jira wiki. Lists nest by repeating the marker (`**`, `#*`); a quote and a callout are macros; a table is `||h||` and `|c|`.

const JIRA_PANEL: Readonly<Record<string, string>> = { NOTE: 'info', INFO: 'info', TIP: 'tip', HINT: 'tip', IMPORTANT: 'note', WARNING: 'warning', CAUTION: 'warning', DANGER: 'warning' };
const JIRA_LANG = /^[A-Za-z0-9+#.-]{1,20}$/;

const JIRA: Dialect = {
  // Characters wiki markup reads as formatting or a macro; `|` only means something in a table.
  // `-` and `+` mean something only at the edge of a word (`-struck-`), `??` quotes; hyphens inside words stay.
  text: (s, inTable) =>
    s
      .replace(inTable ? /[\\*_{}[\]^~|]/g : /[\\*_{}[\]^~]/g, '\\$&')
      .replace(/(?<!\w)[-+](?=\w)|(?<=\w)[-+](?!\w)|\?\?/g, (m) => (m === '??' ? '\\?\\?' : `\\${m}`)),
  strong: (s) => `*${s}*`,
  emphasis: (s) => `_${s}_`,
  strike: (s) => `-${s}-`,
  code: (s, inTable) => `{{${s.replace(inTable ? /[{}|]/g : /[{}]/g, '\\$&')}}}`,
  inlineHtml: () => '',
  link: (label, url) => `[${label}|${url.replace(/[|\]]/g, encodeURIComponent)}]`,
  image: (_alt, url) => `!${url.replace(/[!|]/g, encodeURIComponent)}!`,
  heading: (level, s) => `h${level}. ${s}`,
  quote: (body) => `{quote}\n${body}\n{quote}`,
  callout: (kind, body) => `{${JIRA_PANEL[kind.toUpperCase()] ?? 'info'}}\n${body}\n{${JIRA_PANEL[kind.toUpperCase()] ?? 'info'}}`,
  codeBlock: (value, lang) => `{code${lang !== undefined && JIRA_LANG.test(lang) ? `:${lang}` : ''}}\n${value}\n{code}`,
  thematicBreak: '----',
  table(node, cell) {
    return node.children
      .map((row) => {
        const bar = row.header ? '||' : '|';
        return bar + row.children.map((c) => cell(c.children as Inline[]).replace(/\n/g, ' \\\\ ') || ' ').join(bar) + bar;
      })
      .join('\n');
  },
  bullet(list, item, _index, outer) {
    const task = item.task === 'checked' ? '(/) ' : item.task === 'unchecked' ? '(x) ' : '';
    return `${outer}${list.ordered ? '#' : '*'} ${task}`;
  },
  nest: (list, outer) => `${outer}${list.ordered ? '#' : '*'}`,
  body: (_marker, body) => lines(body).join(' \\\\ '),
  raw: (value) => `{noformat}${value}{noformat}`,
};

// ---------------------------------------------------------------------------------------------------------------

class Writer {
  private readonly d: Dialect;
  private readonly jira: boolean;
  constructor(d: Dialect, jira: boolean) {
    this.d = d;
    this.jira = jira;
  }

  inlines(nodes: readonly Node[], inTable = false, bold = false): string {
    const out: string[] = [];
    for (const n of nodes) out.push(this.inline(n, inTable, bold));
    return out.join('');
  }

  private inline(n: Node, inTable: boolean, bold: boolean): string {
    const d = this.d;
    const kids = (): string => this.inlines((n as { children?: readonly Node[] }).children ?? [], inTable, bold);
    switch (n.type) {
      case 'text': return d.text(n.value, inTable);
      case 'strong': return bold ? kids() : d.strong(kids());
      case 'emphasis': return d.emphasis(kids());
      case 'strikethrough': return d.strike(kids());
      case 'code': return d.code(n.value, inTable);
      case 'link': return d.link(kids(), n.url);
      case 'image': return d.image(n.alt, n.url);
      case 'softBreak': case 'hardBreak': return inTable ? ' ' : '\n';
      case 'footnoteReference': return d.text(`[${n.label}]`, inTable);
      case 'mathInline': return d.code(n.value, inTable);
      case 'html': return d.inlineHtml(n.value);
      case 'taskMarker': return '';
      default: return kids();
    }
  }

  blocks(nodes: readonly Node[], outer = ''): string {
    const out: string[] = [];
    for (const n of nodes) {
      const s = this.block(n as Block, outer);
      if (s !== '') out.push(s);
    }
    return out.join('\n\n');
  }

  private block(n: Block, outer: string): string {
    const d = this.d;
    switch (n.type) {
      case 'heading': return d.heading(n.level, this.inlines(n.children, false, !this.jira));
      case 'paragraph': return this.inlines(n.children);
      case 'blockquote': return this.quote(n, outer);
      case 'list': return this.list(n, outer);
      case 'codeBlock': return d.codeBlock(n.value, n.lang);
      case 'mathBlock': return d.codeBlock(n.value);
      case 'htmlBlock': return d.raw(n.value.replace(/\n$/, ''));
      case 'thematicBreak': return d.thematicBreak;
      case 'table': return d.table(n, (cell) => this.inlines(cell, true));
      case 'footnoteDefinition': return `${d.text(`[${n.label}]`, false)} ${this.blocks(n.children)}`;
      case 'frontmatter': return '';
      default: return this.blocks((n as { children?: readonly Node[] }).children ?? []);
    }
  }

  private quote(n: Extract<Block, { type: 'blockquote' }>, outer: string): string {
    const first = n.children[0];
    const lead = first?.type === 'paragraph' ? first.children[0] : undefined;
    const m = lead?.type === 'text' ? CALLOUT.exec(lead.value) : null;
    if (!m) return this.d.quote(this.blocks(n.children, outer));
    // The marker is the quote's label; the first paragraph keeps whatever follows it (less the line break after the marker).
    const tail = (first as unknown as { children: Inline[] }).children.slice(1);
    const left = (lead as { value: string }).value.slice(m[0].length);
    const head: Inline[] = left === '' ? (tail[0]?.type === 'softBreak' ? tail.slice(1) : tail) : [{ ...lead!, value: left } as Inline, ...tail];
    const rest = [...(head.length === 0 ? [] : [{ ...first!, children: head } as Block]), ...n.children.slice(1)];
    const label = m[1]![0]!.toUpperCase() + m[1]!.slice(1).toLowerCase();
    return this.d.callout(label, this.blocks(rest, outer));
  }

  private list(n: List, outer: string): string {
    const out: string[] = [];
    const inner = this.d.nest(n, outer);
    n.children.forEach((item, i) => {
      const marker = this.d.bullet(n, item, i, outer);
      const own: string[] = [];
      const nested: string[] = [];
      for (const b of item.children) {
        if (b.type === 'list') nested.push(this.list(b, inner));
        else {
          const s = this.block(b, outer);
          if (s !== '') own.push(s);
        }
      }
      out.push(marker + this.d.body(marker, own.join('\n')));
      for (const s of nested) out.push(s);
    });
    return out.join('\n');
  }
}

function convert(lf: string, d: Dialect, jira: boolean): string {
  const text = new Writer(d, jira).blocks(parseText(lf).children);
  return text === '' ? '' : `${text}\n`;
}

export const toSlack: TransformDef = { id: 'to-slack', kind: 'derive', run: (lf) => convert(lf, SLACK, false) };
export const toJira: TransformDef = { id: 'to-jira', kind: 'derive', run: (lf) => convert(lf, JIRA, true) };
