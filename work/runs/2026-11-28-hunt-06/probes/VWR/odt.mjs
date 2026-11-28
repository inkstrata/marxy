// OpenDocument text: a numbered list in a cell, a comment in a cell, an empty numbered item.
import { readOffice } from '../../../../../packages/core/src/office/index.ts';
import { partsReader } from '../../../../../packages/core/src/office/testing/samples.ts';
const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"';
const styles = '<office:automatic-styles><text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style></office:automatic-styles>';
const doc = (body) => ({ 'content.xml': `<office:document-content ${NS}>${styles}<office:body><office:text>${body}</office:text></office:body></office:document-content>` });
const run = async (name, body) => {
  try {
    const r = await readOffice('odt', partsReader(doc(body)));
    console.log('=== ' + name + '\n' + JSON.stringify(r.markdown) + ' comments=' + r.doc.counts.comments);
  } catch (e) {
    console.log('=== ' + name + ' ERROR ' + e.message);
  }
};
const items = (n) => Array.from({ length: n }, (_, i) => `<text:list-item><text:p>item ${i + 1}</text:p></text:list-item>`).join('');
await run('numbered list', `<text:list text:style-name="L1">${items(3)}</text:list>`);
await run('numbered in cell', `<table:table><table:table-row><table:table-cell><text:list text:style-name="L1">${items(2)}</text:list></table:table-cell></table:table-row></table:table>`);
await run('comment in cell', '<table:table><table:table-row><table:table-cell><text:p>cell text<office:annotation><dc:creator>Ann</dc:creator><text:p>note here</text:p></office:annotation></text:p></table:table-cell></table:table-row></table:table>');
await run('empty numbered item', `<text:list text:style-name="L1"><text:list-item><text:p>one</text:p></text:list-item><text:list-item><text:p/></text:list-item><text:list-item><text:p>three</text:p></text:list-item></text:list>`);
await run('spaces', '<text:p>a<text:s text:c="3"/>b<text:tab/>c  d</text:p>');
await run('continue list', `<text:list text:style-name="L1">${items(2)}</text:list><text:p>mid</text:p><text:list text:continue-numbering="true" text:style-name="L1"><text:list-item><text:p>after</text:p></text:list-item></text:list>`);
await run('repeated cols', '<table:table><table:table-row><table:table-cell table:number-columns-repeated="3"><text:p>x</text:p></table:table-cell></table:table-row></table:table>');
await run('spanned', '<table:table><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>wide</text:p></table:table-cell><table:covered-table-cell/><table:table-cell><text:p>z</text:p></table:table-cell></table:table-row></table:table>');
