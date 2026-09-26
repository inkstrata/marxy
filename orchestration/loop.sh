#!/usr/bin/env bash
# Run the reconcile cycle until stopped (ADR-0034). Every cycle is idempotent, so this is safe to
# start, stop and restart; nothing here writes the board.
#
#   ./orchestration/loop.sh start [flags]   # detached: survives the terminal or agent that ran it
#   ./orchestration/loop.sh status          # running or not, since when, the last cycle's lines
#   ./orchestration/loop.sh stop            # finishes the cycle in flight, then exits
#   ./orchestration/loop.sh [run] [flags]   # in this terminal, until Ctrl-C
#
#   INTERVAL=600 ./orchestration/loop.sh start      # slower (default 120 s between cycles)
#   ONCE=1 ./orchestration/loop.sh                  # a single cycle, for cron
#   ./orchestration/loop.sh start --no-merge        # decide everything, merge nothing
#   ./orchestration/loop.sh start --high|--low|--minimal   # compute profile (see models.json)
#
# Each cycle runs the code on origin/main, from a runner worktree the fleet owns
# (<git common dir>/marxy-fleet/runner, detached, reset to origin/main before every cycle). So the
# loop always runs what has merged — a merged fix to the orchestrator takes effect on the next cycle —
# and no checkout anyone works in is read or written by it. MARXY_RUNNER=0 runs this checkout's code
# instead, for developing the orchestrator itself.
#
# One loop at a time (loop.lease in the fleet store). Never pkill it — `stop` lets the cycle in flight
# finish. Workers the cycle starts run detached, so stopping the loop does not stop them; the next
# loop finishes whatever ended while it was away.
set -uo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
HOME_CHECKOUT="$(cd "$(dirname "$SELF")/.." && pwd)"
if [ -n "${MARXY_FLEET_DIR:-}" ]; then FLEET="$MARXY_FLEET_DIR"
else FLEET="$(git -C "$HOME_CHECKOUT" rev-parse --path-format=absolute --git-common-dir)/marxy-fleet"; fi
mkdir -p "$FLEET"
RUNNER="$FLEET/runner"
LEASE="$FLEET/loop.lease"
LOG="$FLEET/loop.log"

json_field() { [ -f "$1" ] && node -e 'try { const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; if (v != null) console.log(v); } catch {}' "$1" "$2"; }
lease_pid() { json_field "$LEASE" pid; }
running() {
  local pid; pid=$(lease_pid)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -o command= -p "$pid" | grep -q 'loop.sh'
}

case "${1:-run}" in
  start)
    shift
    if running; then echo "loop: already running (pid $(lease_pid)); ./orchestration/loop.sh status"; exit 0; fi
    pid=$(node -e '
      const { spawn } = require("node:child_process"); const fs = require("node:fs");
      const fd = fs.openSync(process.argv[1], "a");
      const c = spawn("bash", process.argv.slice(2), { detached: true, stdio: ["ignore", fd, fd] });
      c.unref(); console.log(c.pid);' "$LOG" "$SELF" run "$@")
    sleep 1
    if running; then echo "loop: started, pid $pid, log $LOG"; exit 0; fi
    echo "loop: did not start; the end of $LOG:"; tail -5 "$LOG"; exit 1 ;;
  stop)
    if ! running; then echo "loop: not running"; rm -f "$LEASE"; exit 0; fi
    pid=$(lease_pid)
    kill -TERM "$pid"
    echo "loop: stopping pid $pid once the cycle in flight finishes"
    for _ in $(seq 1 600); do running || { echo "loop: stopped"; exit 0; }; sleep 1; done
    echo "loop: still running after 10 minutes; see $LOG"; exit 1 ;;
  status)
    if running; then echo "loop: running, pid $(lease_pid), since $(json_field "$LEASE" started)"
    elif [ -f "$LEASE" ]; then echo "loop: not running (stale lease from a loop that died)"
    else echo "loop: not running"; fi
    [ -f "$FLEET/status.md" ] && sed -n '1p' "$FLEET/status.md"
    [ -f "$LOG" ] && { echo "── last lines of $LOG"; tail -8 "$LOG"; }
    exit 0 ;;
  run) shift ;;
  -*) ;; # flags only: run in this terminal
  *) echo "usage: loop.sh [start|stop|status|run] [cycle flags]"; exit 2 ;;
esac

if running; then echo "loop: another loop is running (pid $(lease_pid)); ./orchestration/loop.sh stop first"; exit 1; fi
INTERVAL=${INTERVAL:-120}
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ pid: Number(process.argv[2]), host: require("os").hostname(), started: new Date().toISOString(), match: "loop.sh" }) + "\n")' "$LEASE" "$$"
stopping=
sleeper=
# A signal ends the wait, not the sleep it waited on: stop that too (MARXY-210).
stop_sleep() { [ -n "$sleeper" ] && kill "$sleeper" 2>/dev/null; sleeper=; }
trap 'stopping=1; stop_sleep' INT TERM
trap 'stop_sleep; rm -f "$LEASE"; echo "loop: stopped; $FLEET/status.md holds the last cycle"' EXIT

# The code a cycle runs: the runner at origin/main, or this checkout with MARXY_RUNNER=0.
code_root() {
  if [ "${MARXY_RUNNER:-1}" = "0" ]; then echo "$HOME_CHECKOUT"; return; fi
  git -C "$HOME_CHECKOUT" fetch -q origin 2>/dev/null
  if [ ! -e "$RUNNER/.git" ]; then
    git -C "$HOME_CHECKOUT" worktree add -q --detach "$RUNNER" origin/main >/dev/null 2>&1 || { echo "$HOME_CHECKOUT"; return; }
  else
    # Anything an agent left in the runner is kept on a ref, never discarded, before the reset.
    if [ -n "$(git -C "$RUNNER" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
      wip=$(git -C "$RUNNER" -c commit.gpgsign=false stash create "fleet runner before reset" 2>/dev/null)
      [ -n "$wip" ] && git -C "$RUNNER" update-ref "refs/fleet/wip/runner/$(date -u +%Y%m%dT%H%M%SZ)" "$wip"
    fi
    git -C "$RUNNER" checkout -q --detach --force origin/main 2>/dev/null
  fi
  echo "$RUNNER"
}

while [ -z "$stopping" ]; do
  # Rotate at 5 MB so a loop that runs for weeks does not grow without bound.
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ]; then mv -f "$LOG" "$LOG.1"; fi
  root=$(code_root)
  node "$root/orchestration/cycle.mjs" "$@"
  [ -n "${ONCE:-}" ] && exit 0
  [ -n "$stopping" ] && break
  sleep "$INTERVAL" & sleeper=$!
  wait "$sleeper" 2>/dev/null
  sleeper=
done
