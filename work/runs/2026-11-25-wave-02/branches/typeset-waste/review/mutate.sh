#!/bin/bash
# Runs unused-work.test.mjs on the fixed index.ts and on mutations of it; restores the fix after each.
eval "$(fnm env --shell bash)"
W=/c/Dev/reader/worktrees/typeset-waste
S=/c/Dev/reader/work/wave2/typeset-waste/review
SRC=$W/packages/typeset/src/index.ts
cp $SRC $S/index.fixed.ts
runit() {
  echo "=== $1"
  (cd $W/packages/typeset && node --test test/unused-work.test.mjs 2>&1 | grep -E "^[✔✖] |^ℹ (pass|fail)" | sed 's/^/  /')
}
mut() { cp $S/index.fixed.ts $SRC; sed -i "$2" $SRC; if cmp -s $SRC $S/index.fixed.ts; then echo "=== $1: SED DID NOT APPLY"; else runit "$1"; fi; }
runit fixed
mut "out-of-flow blocks ignored" 's/return cs.position === .absolute. || cs.position === .fixed. || cs.float !== .none.;/return false;/'
mut "adopt ignores kill switch" 's/if (bg === null || bg.mine !== generation || killed()) return;/if (bg === null || bg.mine !== generation) return;/'
mut "visible pass always announced" "s/if (batch.moved) opts.onPass?.('visible', batch.set);/opts.onPass?.('visible', batch.set);/"
mut "discard ignored" 's/restoreAll(options?.discard === true);/restoreAll(false);/'
mut "verdict not cached in batch" 's/    verdict = false;/    verdict = null;/'
mut "bisect over paragraphs, not blocks" 's/for (const block of article.children) (outOfFlow(block) ? loose : blocks).push(block);/for (const block of all) blocks.push(block);/'
cp $S/index.fixed.ts $SRC
git -C $W status --short
