#!/usr/bin/env bash
# Headless orchestrator loop (mode B). Each cycle: dispatch what is ready, then hand review packets to the
# orchestrator model, which decides merge/return/escalate. Stops when nothing is ready or in progress.
set -uo pipefail
cd "$(dirname "$0")/.."
BIN=${CURSOR_AGENT:-cursor-agent}
ORCH_MODEL=$(node -e 'console.log(require("./orchestration/models.json").orchestrator.model)')
while true; do
  READY=$(node orchestration/ready.mjs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).ready.map(r=>r.key).join(" ")))')
  [ -n "$READY" ] && node orchestration/dispatch.mjs $READY
  for f in orchestration/results/*.json; do
    [ -e "$f" ] || continue; KEY=$(basename "$f" .json)
    STATUS=$(node -e "console.log(require('./orchestration/state.json').stories['$KEY'].status)")
    [ "$STATUS" = review ] || continue
    PACKET=$(node orchestration/review.mjs "$KEY")
    "$BIN" -p --force --model "$ORCH_MODEL" --output-format text "$(cat orchestration/prompts/orchestrator.md)

You are reviewing one story now. Apply steps 3–4 of your loop to this packet and run the state command that matches your decision.

$PACKET" | tee "orchestration/results/$KEY.review.md"
  done
  node orchestration/planner-trigger.mjs && "$BIN" -p --force --model "$ORCH_MODEL" --output-format text "$(cat orchestration/prompts/planner.md)" | tee "orchestration/results/plan-$(date +%F).md" && node orchestration/state.mjs planned
  node orchestration/ready.mjs | grep -q '"ready": \[\]' && ! grep -q in_progress orchestration/state.json && { echo "nothing ready or in progress; see orchestration/needs-human.md"; break; }
  sleep 60
done
