// Where a relative link in a document leads: one rule for a Markdown page and for every page of the app's own that
// follows links (a Word document's), so none of them can be talked into reaching further than another. A link names a
// file under the document's folder or repository; never another machine (`//host/share`, `\\host\share`, however it is
// encoded), a drive, a scheme or a NUL. A share would be reached the moment its name is looked up, and Windows offers the
// reader's credentials to it, so such a name is refused before anything is read.
import { normalizePath } from '@marxy/core/src/index-model/paths.ts';
import { fileTypeOf, isMarkdownPath } from '@marxy/core/src/kind/registry.ts';
import { collapsePath, isInsideImageRoot } from '@marxy/core/src/render/images.ts';
import { isUntitled } from '../document/untitled.ts';
import { pathsForDocument } from '../render/images.ts';
import { defaultModeForPath, isNamedTextFamily } from '../source/default-mode.ts';

/** A link opens inside Marxy when it leads to a Markdown page or to plain text (`.txt`), as the registry names them. */
const opensInside = (path: string): boolean => isMarkdownPath(path) || fileTypeOf(path)?.id === 'text';

export const LINK_ELSEWHERE = 'That link names another machine, a drive or a scheme · nothing was opened.';
export const LINK_MALFORMED = 'That link is not a well-formed address · nothing was opened.';

/** Why `pathPart`, decoded, may not be followed: another machine, a drive, a scheme or a NUL; null when it may. */
function elsewhere(pathPart: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return LINK_MALFORMED;
  }
  const slashed = decoded.replace(/\\/g, '/');
  if (slashed.includes('\0') || slashed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(slashed)) return LINK_ELSEWHERE;
  return null;
}

/** A drive letter is one drive whatever its case: `c:/r` and `C:/r` name one folder. */
const sameDrive = (p: string): string => p.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);

/**
 * Where a relative link from the document at `path` leads, as a path on disk (decoded), or the notice that says why it
 * does not open.
 * `imageRoot` is the app's answer for `path` (`AppHandle.imageRoot`): the repository root when the
 * document is in one, else its folder.
 */
export function localLinkTarget(
  path: string,
  href: string,
  imageRoot: string,
  /** A link followed beside: a file that opens in Source is a target too; whether it is text is for the caller. */
  opts?: { readonly allowSource?: boolean },
): { readonly target: string; readonly fragment: string | undefined } | { readonly refused: string } {
  // A scratch document has no folder for a relative link to be relative to: refused, nothing read.
  if (isUntitled(path)) return { refused: 'That link points outside this folder and was not opened.' };
  const hash = href.indexOf('#');
  const pathPart = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? undefined : href.slice(hash + 1);
  const why = elsewhere(pathPart);
  if (why) return { refused: why };
  const { documentDir } = pathsForDocument(path);
  const base = documentDir.endsWith('/') ? documentDir : `${documentDir}/`;
  // A drive path (`C:/r/docs`, as the shell hands paths over) is a file URL's path with a slash before it, and comes
  // back out without one. A share's path (`//server/share`) is a file URL's path as it is.
  const drive = /^[A-Za-z]:\//.test(base);
  const share = base.startsWith('//');
  const url = new URL(pathPart, drive ? `file:///${base}` : `file://${base}`);
  if (url.host !== '') return { refused: LINK_ELSEWHERE };
  // The file's own name, decoded once (`my%20notes.md` is `my notes.md`), its `.` and `..` worked out.
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return { refused: LINK_MALFORMED };
  }
  if (drive) decoded = decoded.replace(/^\/(?=[A-Za-z]:)/, '');
  if (decoded.includes('\0')) return { refused: LINK_ELSEWHERE };
  // On Windows a backslash is a separator: one decoded from `%5C` would climb where the checks below saw a name. A
  // POSIX name may hold one.
  if ((drive || share) && decoded.includes('\\')) return { refused: LINK_ELSEWHERE };
  // A colon past the drive names another drive (`a/D:/x`) or a file's hidden stream (`x:y.md`).
  if ((drive ? decoded.slice(2) : decoded).includes(':')) return { refused: LINK_ELSEWHERE };
  const target = collapsePath(normalizePath(decoded));
  if (target === null) return { refused: 'That link points outside this folder and was not opened.' };
  // `../..//host/x` resolves to a path that opens with two slashes: a share's name, unless the document is on a share.
  if (!share && /^(?:[A-Za-z]:)?\/\//.test(target)) return { refused: LINK_ELSEWHERE };
  if (!isInsideImageRoot(sameDrive(target), sameDrive(imageRoot))) {
    const where = normalizePath(imageRoot) === normalizePath(documentDir) ? 'folder' : 'repository';
    return { refused: `That link points outside this ${where} and was not opened.` };
  }
  if (!opensInside(target) && !(opts?.allowSource && (defaultModeForPath(target) === 'source' || isNamedTextFamily(target)))) {
    return { refused: 'Only markdown documents open inside Marxy.' };
  }
  return { target, fragment };
}
