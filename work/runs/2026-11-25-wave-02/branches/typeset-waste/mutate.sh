#!/bin/bash
# Runs unused-work.test.mjs against the fixed index.ts, the builder's, master's, and targeted mutations of the fix.
eval "$(fnm env --shell bash)"
W=/c/Dev/reader/worktrees/typeset-waste
S=/c/Dev/reader/work/wave2/typeset-waste
SRC=$W/packages/typeset/src/index.ts
cp $SRC $S/index.fixed.ts
runit() {
  echo "=== $1"
  (cd $W/packages/typeset && node --test test/unused-work.test.mjs 2>&1 | grep -E "^[✔✖] |^ℹ (pass|fail)" | sed 's/^/  /')
}
runit fixed
git -C $W show HEAD:packages/typeset/src/index.ts > $SRC; runit builder
git -C $W show 17cfe661:packages/typeset/src/index.ts > $SRC; runit master
cp $S/index.fixed.ts $SRC; sed -i 's/if (batch.moved) opts.onPass?.(.visible., batch.set);/opts.onPass?.("visible", batch.set);/' $SRC; runit "visible pass always announced"
cp $S/index.fixed.ts $SRC; sed -i 's/restoreAll(options?.discard === true);/restoreAll(false);/' $SRC; runit "discard ignored"
cp $S/index.fixed.ts $SRC; sed -i 's/    verdict = false;/    verdict = null;/' $SRC; runit "verdict not cached in batch"
cp $S/index.fixed.ts $SRC; sed -i 's/if (bg === null || bg.mine !== generation) return;\n    const found/X/; s/^    if (bg === null || bg.mine !== generation) return;$/    if (bg === null || bg.mine !== generation || killed()) return;/' $SRC; runit "adopt reads kill switch"
cp $S/index.fixed.ts $SRC
git -C $W diff --stat
