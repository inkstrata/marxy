// What the Library and a folder's page say about places and folders: why search leaves one out, how a file would be read
// by its name, and the places in the reader's order. Pure.
import { isDeniedName } from '@marxy/core/src/index-model/deny.ts';
import { fileTypeFor, searchSkipReason } from '@marxy/core/src/kind/registry.ts';


/** Why search leaves a folder out, or null when it does not. */
export function leftOutWhy(name: string): string | null {
  if (isDeniedName(name)) return `${name} is a folder of tools and builds, which search leaves out`;
  if (name.startsWith('.')) return 'a dot folder: search leaves it out unless Settings says to search dot folders';
  return null;
}

const BINARY_WORDS: Readonly<Record<string, string>> = {
  image: 'an image', audio: 'audio', video: 'video', archive: 'an archive', font: 'a font', pdf: 'a PDF',
  program: 'a Windows program or library', executable: 'a program or a library', office: 'an office document', database: 'a database', book: 'a book',
};

/**
 * How a file opens, said as the Reading card says it: "Markdown", "a log", "data, a tree", "code (rust)", "binary, an
 * image". `path` is a name or a whole path: a whole one also gets what its head said. `skipped` is why Find does not
 * read it, or null when it does.
 */
export function readAsWords(path: string): { readonly words: string; readonly searched: boolean; readonly skipped: string | null } {
  const type = fileTypeFor(path.includes('/') ? path : `/${path}`);
  const skipped = searchSkipReason(type);
  if (type.id === 'unknown') return { words: 'text, set as written', searched: skipped === null, skipped };
  const words =
    type.kind === 'binary'
      ? `binary${BINARY_WORDS[type.id] ? `, ${BINARY_WORDS[type.id]}` : ''}`
      : type.kind === 'markdown'
      ? 'Markdown'
      : type.kind === 'text'
        ? 'text'
        : type.kind === 'theme'
          ? 'a theme file'
          : type.lang === 'log'
            ? 'a log'
            : type.lang === 'diff'
              ? 'a patch'
              : type.reading === 'table'
                ? 'data, a table'
                : type.reading === 'records'
                  ? 'data, records'
                  : type.reading === 'tree'
                    ? 'data, a tree'
                    : type.lang === 'terminal'
                      ? 'a terminal session'
                      : `code${type.lang ? ` (${type.lang})` : ''}`;
  return { words, searched: skipped === null, skipped };
}

/**
 * `places` in the reader's order: those `order` names first, as it names them, then the rest as they came. A path in
 * `order` that is no place now is passed over, and kept there in case it comes back.
 */
export function inOrder<T extends { readonly root: string }>(places: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((path, i) => [path, i]));
  return places
    .map((place, i) => ({ place, i, r: rank.get(place.root) }))
    .sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.i - b.i)
    .map((x) => x.place);
}

/**
 * The order with `root` moved one place up or down among `shown`, the places in the order they are listed now. A place
 * `kept` remembers that is not listed now keeps its name in the order after them, as `inOrder` promises.
 */
export function moved(shown: readonly string[], root: string, by: -1 | 1, kept: readonly string[] = []): string[] {
  const at = shown.indexOf(root);
  const to = at + by;
  const out = [...shown];
  if (at >= 0 && to >= 0 && to < shown.length) [out[at], out[to]] = [out[to]!, out[at]!];
  return [...out, ...kept.filter((path) => !shown.includes(path))];
}
