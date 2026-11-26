// The page's account of itself: what a reading shows and why it is faithful to the file. It is the app's, not the
// file's, so it stays folded: the page's caption is the key that opens it, one line of meta above the content. One
// switch opens or folds it on every page (the desktop's account.ts), and the Metadata panel lists the same sentences.

export const ACCOUNT_KEY = 'How this is shown';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The page's line of meta: its caption as the key to the account, which opens beneath it. `caption` is markup, already
 * escaped; `headAttrs` go on the caption's element (the records' count, set again as rows are read). With no sentences
 * the caption stands alone; with no caption the key says {@link ACCOUNT_KEY}. Each line is plain text, a sentence or a few.
 */
export function accountHtml(lines: readonly string[], caption = '', headAttrs = ''): string {
  const said = lines.filter((l) => l.trim() !== '');
  if (said.length === 0) return caption === '' ? '' : `<div class="marxy-reading-head"${headAttrs}>${caption}</div>`;
  const key = caption === '' ? ACCOUNT_KEY : `<span class="marxy-reading-head"${headAttrs}>${caption}</span>`;
  // The caption is the key's name; what pressing it does is its description.
  const title = caption === '' ? '' : ` title="${ACCOUNT_KEY}"`;
  return (
    `<div class="marxy-account" data-marxy-account><button type="button" class="marxy-account-key" aria-expanded="false"${title}>${key}</button>` +
    `<div class="marxy-account-body">${said.map((l) => `<p>${esc(l)}</p>`).join('')}</div></div>`
  );
}
