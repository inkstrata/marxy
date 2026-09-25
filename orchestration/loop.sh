#!/usr/bin/env bash
# Run the orchestrator cycle until stopped. Every cycle is idempotent, so this is safe to start,
# stop and restart; Jira and state.json are written by the cycle, not by this wrapper.
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
# One loop at a time: results/loop.lease names the running one, and start/run refuse a second
# (MARXY-208). Never pkill it — `stop` lets the cycle in flight finish. Implementors the cycle
# starts run detached with their own leases, so stopping the loop, closing the terminal or putting
# the machine to sleep does not kill them; node orchestration/doctor.mjs shows all of it.
# Dispatching implementors still needs either the Cursor CLI on PATH (then the cycle does it
# headlessly) or the in-app orchestrator, which the cycle tells you by naming the keys.
set -uo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")/.."
RESULTS=orchestration/results
LEASE=$RESULTS/loop.lease
LOG=$RESULTS/loop.log
mkdir -p "$RESULTS"

lease_pid() { [ -f "$LEASE" ] && sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$LEASE"; }
running() {
  local pid; pid=$(lease_pid)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -o command= -p "$pid" | grep -q 'loop.sh'
}

case "${1:-run}" in
  start)
    shift
    if running; then echo "loop: already running (pid $(lease_pid)); ./orchestration/loop.sh status"; exit 0; fi
    # A new session with its output in a file: nothing ties the loop to this shell.
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
    if running; then echo "loop: running, pid $(lease_pid), $(sed -n 's/.*"started":"\([^"]*\)".*/since \1/p' "$LEASE")"
    elif [ -f "$LEASE" ]; then echo "loop: not running (stale lease from a loop that died)"
    else echo "loop: not running"; fi
    [ -f orchestration/status.md ] && sed -n '1p' orchestration/status.md
    [ -f "$LOG" ] && { echo "── last lines of $LOG"; tail -8 "$LOG"; }
    exit 0 ;;
  run) shift ;;
  -*) ;; # flags only: run in this terminal, as before
  *) echo "usage: loop.sh [start|stop|status|run] [cycle flags]"; exit 2 ;;
esac

if running; then echo "loop: another loop is running (pid $(lease_pid)); ./orchestration/loop.sh stop first"; exit 1; fi
INTERVAL=${INTERVAL:-120}
printf '{"pid":%s,"host":"%s","started":"%s","match":"loop.sh"}\n' "$$" "$(hostname)" "$(date -u +%FT%TZ)" > "$LEASE"
stopping=
# TERM or INT, during a cycle or between cycles: the loop ends at the next boundary.
trap 'stopping=1' INT TERM
trap 'rm -f "$LEASE"; echo "loop: stopped; orchestration/status.md holds the last cycle"' EXIT
while [ -z "$stopping" ]; do
  echo "── cycle $(date -u +%FT%TZ)"
  node orchestration/cycle.mjs "$@"
  [ -n "${ONCE:-}" ] && exit 0
  [ -n "$stopping" ] && break
  sleep "$INTERVAL" & wait $! 2>/dev/null
done
