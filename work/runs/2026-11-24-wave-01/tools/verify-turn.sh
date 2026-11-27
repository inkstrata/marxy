#!/usr/bin/env bash
# Runs `pnpm verify` in one wave-1 worktree, at most two such runs on the machine at a time.
# usage: bash /c/Dev/reader/work/wave1/verify-turn.sh <worktree-name> [verify arguments, default: --tier changed]
# Output goes to work/wave1/<name>-verify.log as well as stdout. Exit code is verify's.
set -u
NAME="$1"; shift
W="/c/Dev/reader/worktrees/$NAME"
LOCKS=/c/Dev/reader/work/wave1/locks
LOG="/c/Dev/reader/work/wave1/$NAME-verify.log"
mkdir -p "$LOCKS"
slot=""
while [ -z "$slot" ]; do
  for s in a b; do
    if mkdir "$LOCKS/$s" 2>/dev/null; then
      slot=$s
      echo "$NAME $(date -Is)" > "$LOCKS/$s/owner"
      break
    fi
    # A slot older than 100 minutes was left by a run that died.
    if [ -n "$(find "$LOCKS/$s" -maxdepth 0 -mmin +100 2>/dev/null)" ]; then rm -rf "$LOCKS/$s"; fi
  done
  if [ -z "$slot" ]; then sleep 20; fi
done
trap 'rm -rf "$LOCKS/$slot"' EXIT
eval "$(fnm env --shell bash)"
if [ "$#" -eq 0 ]; then set -- --tier changed; fi
echo "verify-turn: slot $slot, $NAME, pnpm verify $* ($(date -Is))" | tee "$LOG"
cd "$W" && pnpm verify "$@" 2>&1 | tee -a "$LOG"
code=${PIPESTATUS[0]}
echo "verify-turn: exit $code ($(date -Is))" | tee -a "$LOG"
exit "$code"
