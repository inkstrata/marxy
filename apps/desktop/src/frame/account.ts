// The page's account (core's reading/account.ts draws it as markup): folded under the page's caption, which is the key
// that opens it, so a page has one line of meta. One switch for every page: open it on one and it is open on the next,
// and across launches. The state sits on <html> so a page drawn later (a string of HTML from core, a viewer's own DOM)
// is open or folded by CSS alone, with no hook into each drawer.
import { ACCOUNT_KEY } from '@marxy/core/src/reading/account.ts';

const ATTR = 'data-marxy-account-open';
const KEY = 'marxy.account.open';
/** Pages drawn inside a page (a fenced part, an entry previewed in an archive) carry no account of their own. */
const INNER = '.marxy-part, .marxy-embed';
/** A fold drawn with the account's key that holds its own open state (a folder page's left-out rules), not the switch. */
const OWN = '.marxy-account-own';

export function accountOpen(): boolean {
  return document.documentElement.hasAttribute(ATTR);
}

function sync(): void {
  const open = accountOpen();
  for (const b of document.querySelectorAll<HTMLButtonElement>(`.marxy-account-key:not(${OWN} > *)`)) b.setAttribute('aria-expanded', String(open));
}

export function setAccountOpen(open: boolean): void {
  document.documentElement.toggleAttribute(ATTR, open);
  try {
    localStorage.setItem(KEY, open ? '1' : '0');
  } catch {
    // Private storage refused: the switch still holds for this window.
  }
  sync();
}

function said(lines: readonly string[]): string[] {
  return lines.filter((l) => l.trim() !== '');
}

function bodyOf(lines: readonly string[]): HTMLElement {
  const body = document.createElement('div');
  body.className = 'marxy-account-body';
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    body.append(p);
  }
  return body;
}

function keyButton(): HTMLButtonElement {
  const key = document.createElement('button');
  key.type = 'button';
  key.className = 'marxy-account-key';
  key.setAttribute('aria-expanded', String(accountOpen()));
  return key;
}

/**
 * The key and the sentences apart, for a viewer that puts the key at the end of its own toolbar row and the sentences
 * under that row. The key shows `caption` (its accessible name), or says How this is shown without one; `headClass`
 * is added to the caption's element. Null when there is nothing to say.
 */
export function accountKey(lines: readonly string[], caption?: string, headClass?: string): { readonly key: HTMLButtonElement; readonly body: HTMLElement } | null {
  const words = said(lines);
  if (words.length === 0) return null;
  const key = keyButton();
  if (caption) {
    const head = document.createElement('span');
    head.className = headClass ? `marxy-reading-head ${headClass}` : 'marxy-reading-head';
    head.textContent = caption;
    key.append(head);
    key.title = ACCOUNT_KEY;
  } else key.textContent = ACCOUNT_KEY;
  return { key, body: bodyOf(words) };
}

/**
 * The page's line of meta as one element: the caption as the key, the account beneath it (the same markup as core's
 * accountHtml, made as nodes). With nothing to say, the caption alone in a `p`; null with neither.
 */
export function accountElement(lines: readonly string[], caption?: string, headClass?: string): HTMLElement | null {
  const made = accountKey(lines, caption, headClass);
  if (!made) {
    if (!caption) return null;
    const p = document.createElement('p');
    p.className = headClass ? `marxy-reading-head ${headClass}` : 'marxy-reading-head';
    p.textContent = caption;
    return p;
  }
  const box = document.createElement('div');
  box.className = 'marxy-account';
  box.setAttribute('data-marxy-account', '');
  box.append(made.key, made.body);
  return box;
}

/**
 * The key for a caption line that holds more than words (a link, a name in bold that a page sets again): the key is the
 * chevron alone, before the line, and the account opens beneath it. The line keeps its own element and class.
 */
export function accountBeside(line: HTMLElement, lines: readonly string[]): HTMLElement {
  const words = said(lines);
  if (words.length === 0) return line;
  const key = keyButton();
  key.classList.add('marxy-account-key-bare');
  key.setAttribute('aria-label', ACCOUNT_KEY);
  key.title = ACCOUNT_KEY;
  const box = document.createElement('div');
  box.className = 'marxy-account marxy-account-beside';
  box.setAttribute('data-marxy-account', '');
  box.append(key, line, bodyOf(words));
  return box;
}

/** The account's sentences on the page `host` shows, for the Metadata panel. */
export function accountLinesIn(host: ParentNode): string[] {
  const body = [...host.querySelectorAll<HTMLElement>('.marxy-account-body')].find((b) => b.closest('[hidden]') === null && b.closest(INNER) === null);
  return body ? [...body.querySelectorAll('p')].map((p) => p.textContent ?? '') : [];
}

export function installAccount(): () => void {
  const life = new AbortController();
  const { signal } = life;
  let open = false;
  try {
    open = localStorage.getItem(KEY) === '1';
  } catch {
    open = false;
  }
  document.documentElement.toggleAttribute(ATTR, open);
  document.addEventListener(
    'click',
    (e) => {
      const key = (e.target as Element | null)?.closest?.('.marxy-account-key');
      if (!key || key.closest(OWN)) return;
      e.preventDefault();
      e.stopPropagation();
      setAccountOpen(!accountOpen());
    },
    { capture: true, signal },
  );
  // A key drawn after the last switch says the state the moment it is reached.
  document.addEventListener('focusin', (e) => {
    const t = e.target as Element | null;
    if (t?.classList?.contains('marxy-account-key') && !t.closest(OWN)) t.setAttribute('aria-expanded', String(accountOpen()));
  }, { signal });
  return () => life.abort();
}
