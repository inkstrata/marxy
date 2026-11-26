// Log times in your zone (proposal `log_zone`): asked for in the Levels card, a log's timestamps are drawn as the same
// instants in the reader's zone. Only the drawing changes: the log page (render/log-page.ts) draws each time of day over the
// file's text, which stays the page's text (copy, find and the byte map read it), and this says which zone it draws them in,
// as `data-marxy-log-zone` on the article. Source keeps the file's own.
import { LOG_ZONE, redrawLogPage } from '../render/log-page.ts';
import { onProposals } from './state.ts';

const on = new Set<HTMLElement>();

export function logZoneOn(article: HTMLElement): boolean {
  return article.hasAttribute(LOG_ZONE);
}

export function setLogZone(article: HTMLElement, want: boolean): void {
  if (want === logZoneOn(article)) return;
  if (want) {
    article.setAttribute(LOG_ZONE, '');
    on.add(article);
  } else {
    article.removeAttribute(LOG_ZONE);
    on.delete(article);
  }
  redrawLogPage(article);
}

onProposals((now) => {
  if (!now.log_zone) for (const article of [...on]) setLogZone(article, false);
});
