#!/usr/bin/env bash
# Run the orchestrator cycle until interrupted. Every cycle is idempotent, so this is safe to
# start, stop and restart; Ctrl-C leaves the board consistent because Jira and state.json are
# written by the cycle, not by this wrapper.
#   ./orchestration/loop.sh                 # forever, 120 s between cycles
#   INTERVAL=600 ./orchestration/loop.sh    # slower
#   ./orchestration/loop.sh --no-merge      # decide everything, merge nothing
#   ONCE=1 ./orchestration/loop.sh          # a single cycle, for cron
#   ./orchestration/loop.sh --high          # Opus tier: strongest judgement, highest cost
#   ./orchestration/loop.sh --low           # Sonnet 5 medium, Composer implementor (the default)
#   ./orchestration/loop.sh --minimal       # Cursor-only floor: Composer + Grok, no Claude/GPT
#   MARXY_COMPUTE=low ./orchestration/loop.sh
# Dispatching implementors still needs either the Cursor CLI on PATH (then the cycle does it
# headlessly) or the in-app orchestrator, which the cycle tells you by naming the keys.
set -uo pipefail
cd "$(dirname "$0")/.."
# Cursor's installer puts cursor-agent here; orchestration also resolves it, but the loop should see it on PATH.
case ":${PATH}:" in *":${HOME}/.local/bin:"*) ;; *) export PATH="${HOME}/.local/bin:${PATH}";; esac
INTERVAL=${INTERVAL:-120}
trap 'echo; echo "loop: interrupted; orchestration/status.md holds the last cycle"; exit 0' INT TERM
while true; do
  echo "── cycle $(date -u +%FT%TZ)"
  node orchestration/cycle.mjs "$@"
  [ -n "${ONCE:-}" ] && exit 0
  sleep "$INTERVAL"
done
