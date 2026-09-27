// What an open pull request's title says about who lands it.
//
//   (no mark)   the cycle will merge it. This is the ordinary case, so it is not written out.
//   (signed)    an agent has signed this head
//   [human]     only a person can merge it
//
// The two marks combine: `[human] (signed)`. Both are display. The squash subject is the title
// with them removed, passed as `--subject`, and the conventions job lints that bare title.
import { pathToFileURL } from 'node:url';

const MARK_RE = /^(?:\[human\]\s+)?(?:\(signed\)\s+)?/;

/**
 * `waitingOn` is readiness.mjs's word (`author` is the code owner). A signed approval is
 * `reviewed`. The cycle merges everything that is not `[human]`.
 */
export function landsOf({ waitingOn, reviewed = false } = {}) {
  const human = waitingOn === 'author';
  const signed = Boolean(reviewed);
  return { human, signed, mark: pullMark({ human, signed }) };
}

/** The title prefix, or '' when the cycle's merge is left implied. */
export function pullMark({ human = false, signed = false } = {}) {
  return [human ? '[human]' : '', signed ? '(signed)' : ''].filter(Boolean).join(' ');
}

/** The squash subject: the title with a leading `[human]` and `(signed)` removed. */
export function bareTitle(title) {
  return String(title ?? '').replace(MARK_RE, '');
}

/** The open pull request's title. An empty mark is the bare subject. */
export function displayTitle(title, mark = '') {
  const bare = bareTitle(title).trim();
  return mark ? `${mark} ${bare}` : bare;
}

/** The edit to make, or null when the title already says this. An empty mark strips a stale one. */
export function titleUpdate(current, mark = '') {
  const bare = bareTitle(current).trim();
  if (!bare) return null;
  const title = displayTitle(bare, mark);
  return title === String(current) ? null : { title, bare };
}

function main() {
  if (!process.argv.includes('--bare')) {
    console.error('usage: node orchestration/pr-mark.mjs --bare   (title in $PR_TITLE)');
    process.exit(2);
  }
  process.stdout.write(`${bareTitle(process.env.PR_TITLE ?? '')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
