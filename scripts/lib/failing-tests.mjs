// Names the failing tests in a step's output. node:test ends a failed run with a "failing tests:" section
// (each `✖ name`, then its assertion message and a stack); the last lines of a run are only the tail of the last
// assertion (`diff: 'simple'`), which says nothing about which test failed. Returns short display lines.
const CAP = 12;
export function failingTests(output) {
  const text = String(output).replace(/\x1b\[[0-9;]*m/g, '');
  const at = text.indexOf('failing tests:');
  const lines = (at >= 0 ? text.slice(at) : text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:✖|not ok \d+ -)\s+(.*?)(?:\s+\([\d.]+m?s\))?\s*$/.exec(lines[i]);
    if (!m || /^failing tests:?$/.test(m[2])) continue;
    // the message: the lines after the name up to the first stack frame, blank lines dropped
    const msg = [];
    for (let j = i + 1; j < lines.length && msg.length < 3; j++) {
      const l = lines[j].trim();
      if (/^(at |✖|not ok|ℹ|---|\.\.\.)/.test(l) || /^\w+ \{$/.test(l) || /^generatedMessage/.test(l)) break;
      if (l) msg.push(l);
    }
    out.push(`${m[2]}${msg.length ? `: ${msg.join(' ')}` : ''}`.slice(0, 400));
  }
  const seen = [...new Set(out)];
  return seen.length > CAP ? [...seen.slice(0, CAP), `… and ${seen.length - CAP} more`] : seen;
}
