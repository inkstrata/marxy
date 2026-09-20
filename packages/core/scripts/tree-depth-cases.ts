// The 35 tree-construction shapes measured in review (MARXY-84): each input exercises implied end
// tags, table insertion, or the writer stack, and the list length is asserted so adding or removing
// a shape is a deliberate diff.

export interface TreeDepthCase {
  readonly id: string;
  readonly html: string;
}

/** Exactly the shapes from the MARXY-12 review measurement; do not grow or shrink without intent. */
export const TREE_DEPTH_CASES: readonly TreeDepthCase[] = [
  { id: 'solidus-anchor-tail', html: '<a href="https://example.com/" />para' },
  { id: 'solidus-blockquote-tail', html: '<blockquote />textmore' },
  { id: 'anchor-slash-form', html: '<a/href="http://x.example/" title="z" />y</a>' },
  { id: 'unclosed-anchor-before-paragraph', html: '<a href="https://example.com/">t<p>b</p>' },
  {
    id: 'unclosed-anchor-paragraph-heading',
    html: '<a href="https://example.com/" />para<p>a paragraph</p><h2>a heading</h2>',
  },
  { id: 'unclosed-em', html: '<em>text' },
  { id: 'unclosed-strong', html: '<p><strong>bold' },
  { id: 'paragraph-in-paragraph', html: '<p>one<p>two' },
  { id: 'list-item-in-list-item', html: '<ul><li>one<li>two' },
  { id: 'unordered-list-unclosed-item', html: '<ul><li>a' },
  { id: 'ordered-list-unclosed-item', html: '<ol><li>a' },
  { id: 'table-cell-only', html: '<table><td>x</td>' },
  { id: 'table-row-and-cell', html: '<table><tr><td>x</td></tr>' },
  { id: 'table-body-row-cell', html: '<table><tbody><tr><td>x</td></tr></tbody>' },
  { id: 'table-head-row-header', html: '<table><thead><tr><th>h</th></tr></thead>' },
  { id: 'table-foot-row-cell', html: '<table><tfoot><tr><td>f</td></tr></tfoot>' },
  { id: 'row-cell-only', html: '<tr><td>x</td>' },
  { id: 'cell-only', html: '<td>x</td>' },
  { id: 'body-cell-only', html: '<tbody><td>x</td></tbody>' },
  { id: 'table-head-body-row-cell', html: '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody>' },
  { id: 'blockquote-paragraph', html: '<blockquote><p>q</p>' },
  { id: 'definition-list', html: '<dl><dt>t<dd>d' },
  { id: 'heading-in-paragraph', html: '<p>before<h2>head</h2>' },
  { id: 'table-paragraph-in-cell', html: '<table><tr><td><p>in cell</p></td></tr></table>' },
  { id: 'nested-emphasis', html: '<p><em><strong>x' },
  { id: 'anchor-emphasis-in-paragraph', html: '<p><a href="#x"><em>link' },
  { id: 'table-row-multiple-cells', html: '<table><tr><td>a</td><td>b</td></tr></table>' },
  { id: 'table-header-cell-row', html: '<table><tr><th>h</th><td>d</td></tr></table>' },
  { id: 'unclosed-table', html: '<table><tr><td>x' },
  { id: 'list-paragraph-item', html: '<ul><li><p>item</p></li></ul>' },
  { id: 'horizontal-rule-between-paragraphs', html: '<p>a</p><hr><p>b</p>' },
  { id: 'line-break-in-paragraph', html: '<p>a<br>b' },
  { id: 'table-data-header-same-row', html: '<table><tbody><tr><th>h</th><td>d</td></tr></tbody></table>' },
  { id: 'nested-table-in-cell', html: '<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>' },
  { id: 'table-row-unclosed-cell', html: '<table><tr><td>a<td>b</td></tr></table>' },
];

export const TREE_DEPTH_CASE_COUNT = 35 as const;
