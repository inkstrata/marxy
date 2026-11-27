#!/usr/bin/env bash
# Runs `pnpm verify` in one worktree, at most two such runs on the machine at a time.
# Run it with the Bash tool (Git Bash), not `bash` typed into PowerShell, which may be WSL.
#
# usage: bash /c/Dev/reader/work/plan/verify-turn.sh <worktree-name> <log-folder> [verify arguments]
#   <worktree-name>  a folder under C:\Dev\reader\worktrees
#   <log-folder>     where <worktree-name>-verify.log is written, e.g. /c/Dev/reader/work/wave2
#   verify arguments default to `--tier changed`; a branch cut from an unlanded branch adds `--base agent/<that branch>`
#
# It shares its two slots (folders `a` and `b` under work/wave1/locks) with work/wave1/verify-turn.sh.
# A full verify should hold both: `mkdir` both folders by hand before it and remove them after.
# Exit code is verify's.
set -u
NAME="$1"; LOGDIR="$2"; shift 2
W="/c/Dev/reader/worktrees/$NAME"
LOCKS=/c/Dev/reader/work/wave1/locks
LOG="$LOGDIR/$NAME-verify.log"
mkdir -p "$LOCKS" "$LOGDIR"
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
