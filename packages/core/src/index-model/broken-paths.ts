// Broken paths (Q-06): the paths a file's text names that do not exist. Pure: no DOM, no Node; the caller injects `stat`.
//
// Which paths a text names is `pathMentions` (the Extract group's rule, also the inspector's Links tab): backticked, with a
// slash and an extension, in the prose (code blocks and front matter are not read). Whether one exists is the Links tab's
// rule (`resolveMentioned` in the desktop app's workspace/links-tab.ts), restated here so the library and the tab cannot
// disagree (the desktop app's library/checks.test.ts holds the two to the same table):
//   * a path is looked for beside the file and in its repository root (a `~/` path in the home folder);
//   * found in either, it exists;
//   * missing is claimed only when every folder above it, up to that root, is a real, listed folder. `stat` answers null
//     for a symlink and a deny-listed folder too, so a path under one of those, a `~/` path with no known home, and a path
//     that climbs out of its root are "not checked", never broken.
import { pathMentions } from '../transforms/extract.ts';
import { dirname } from './paths.ts';

export type Mentioned = 'found' | 'not-found' | 'not-checked';

export interface StatResult {
  readonly isDir?: boolean;
}
export type StatFn = (path: string) => Promise<StatResult | null>;

/** `rest` under `dir`, lexically: `.` dropped, `..` climbs. Always absolute. */
function join(dir: string, rest: string): string {
  const out: string[] = dir.split('/').filter((p) => p !== '');
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

/** Whether `path`, named in the file at `docPath` under `root`, exists: the Links tab's rule, above. */
export async function resolveMention(path: string, docPath: string, root: string, home: string | null, stat: StatFn): Promise<Mentioned> {
  let bases: string[];
  let rest = path;
  let limit = root;
  if (path.startsWith('~/')) {
    if (home === null) return 'not-checked';
    bases = [home];
    limit = home;
    rest = path.slice(2);
  } else {
    bases = [...new Set([dirname(docPath), root])];
  }
  let checkable = true;
  for (const base of bases) {
    const target = join(base, rest);
    if (target === limit || !target.startsWith(limit === '/' ? '/' : `${limit}/`)) {
      checkable = false;
      continue;
    }
    try {
      if ((await stat(target)) !== null) return 'found';
      const names = target.slice(limit === '/' ? 1 : limit.length + 1).split('/');
      let at = limit;
      let listed = (await stat(limit))?.isDir === true;
      for (const name of names.slice(0, -1)) {
        if (!listed) break;
        at = join(at, name);
        listed = (await stat(at))?.isDir === true;
      }
      if (!listed) checkable = false;
    } catch {
      checkable = false;
    }
  }
  return checkable ? 'not-found' : 'not-checked';
}

/** The paths a text names, in order of first mention: `pathMentions` over the text with its line endings made LF. */
export function mentionsOf(text: string): string[] {
  // Most files name no path: without a backtick and a slash there is nothing to parse for.
  if (!text.includes('`') || !text.includes('/')) return [];
  // Nor without one backticked path of the shape `pathMentions` takes: the parse is the costly part, so it is skipped.
  if (!/`[~.\w-]*\/[\w./-]+\.\w{1,6}`/.test(text)) return [];
  return pathMentions(text.replace(/\r\n?/g, '\n'));
}

export interface BrokenPaths {
  /** The paths named that do not exist, in order of first mention. */
  readonly missing: readonly string[];
  /** Paths named that could not be checked (see above). */
  readonly notChecked: number;
  /** Every path named. */
  readonly mentioned: number;
}

/** Each of `mentions` resolved for the file at `docPath`; a `stat` that throws leaves that path not checked. */
export async function brokenPaths(mentions: readonly string[], docPath: string, root: string, home: string | null, stat: StatFn): Promise<BrokenPaths> {
  const missing: string[] = [];
  let notChecked = 0;
  for (const p of mentions) {
    const r = await resolveMention(p, docPath, root, home, stat).catch((): Mentioned => 'not-checked');
    if (r === 'not-found') missing.push(p);
    else if (r === 'not-checked') notChecked++;
  }
  return { missing, notChecked, mentioned: mentions.length };
}
