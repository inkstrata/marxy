// The pane head as an address: the folders from the place the file is in down to it, and the chain of
// headings the reading line is under, with each step's siblings. Pure: no DOM; the head draws what this says.
import { pathRoot } from '../left/doc-model.ts';

/** A heading by where it starts. `level` 1 is the outermost. */
export interface HeadingMark {
  readonly level: number;
  readonly text: string;
  readonly start: number;
}

/** One folder step of an address: its label and the folder it opens. */
export interface FolderStep {
  readonly label: string;
  readonly dir: string;
}

/** The index of the last heading starting at or before `at` (binary search), or -1. */
export function headingIndexAt(headings: readonly HeadingMark[], at: number): number {
  let lo = 0;
  let hi = headings.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (headings[mid]!.start <= at) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** The headings whose sections hold byte `at`, outermost first: the last one before it, then each shallower one above. */
export function headingChain(headings: readonly HeadingMark[], at: number): number[] {
  const chain: number[] = [];
  let depth = Infinity;
  for (let i = headingIndexAt(headings, at); i >= 0; i--) {
    const level = headings[i]!.level;
    if (level >= depth) continue;
    chain.unshift(i);
    depth = level;
    if (level <= 1) break;
  }
  return chain;
}

/** The headings beside heading `i`: its own level, within the section that holds it. */
export function siblingHeadings(headings: readonly HeadingMark[], i: number): number[] {
  const level = headings[i]?.level;
  if (level === undefined) return [];
  let a = i;
  let b = i;
  while (a > 0 && headings[a - 1]!.level >= level) a--;
  while (b < headings.length - 1 && headings[b + 1]!.level >= level) b++;
  const out: number[] = [];
  for (let j = a; j <= b; j++) if (headings[j]!.level === level) out.push(j);
  return out;
}

const trimEnd = (p: string): string => (p.length > 1 ? p.replace(/[/\\]+$/, '') : p);

/**
 * The folders from the place (`roots`, the Library's) that holds `path` down to its own folder, the deepest place
 * first. A file in no place is addressed from its drive or `/`.
 */
export function folderSteps(path: string, roots: readonly string[]): FolderStep[] {
  const norm = path.replace(/\\/g, '/');
  const cut = norm.lastIndexOf('/');
  if (cut < 0) return [];
  const dir = norm.slice(0, cut) || '/';
  const root = roots
    .map((r) => trimEnd(r.replace(/\\/g, '/')))
    .filter((r) => dir === r || dir.startsWith(r.endsWith('/') ? r : `${r}/`))
    .sort((a, b) => b.length - a.length)[0];
  const steps: FolderStep[] = [];
  // A bare drive (`C:`) names that drive's current folder, not its root.
  const asDir = (d: string): string => (/^[A-Za-z]:$/.test(d) ? `${d}/` : d);
  if (root !== undefined) {
    steps.push({ label: root.slice(root.lastIndexOf('/') + 1) || root, dir: asDir(root) });
    const rest = dir.slice(root.length).split('/').filter(Boolean);
    let at = root;
    for (const part of rest) {
      at = `${at === '/' ? '' : at}/${part}`;
      steps.push({ label: part, dir: at });
    }
    return steps;
  }
  // The top is the drive, the UNC share (`//host/share`) or `/`.
  const top = pathRoot(dir) || '/';
  steps.push({ label: top, dir: asDir(top) });
  let at = top;
  for (const part of dir.slice(top === '/' ? 0 : top.length).split('/').filter(Boolean)) {
    at = `${at === '/' ? '' : at}/${part}`;
    steps.push({ label: part, dir: at });
  }
  return steps;
}
