#!/bin/zsh
cd "${MARXY:-.}"  # a checkout of the app
P="$(git rev-parse --show-toplevel)"/docs/research/windowed-pages/probes/node-budget
N() { node $P/node-budget.mjs --repo $PWD --reps 9 --settle 150 "$@"; }
N --browser webkit --kind md-dense --sizes 60k,250k,500k,1m --json $P/webkit-md-dense.json > /dev/null 2> $P/webkit-md-dense.log
N --browser webkit --kind md-prose --sizes 500k,1m,2m --has drop --json $P/webkit-md-prose-nohas.json > /dev/null 2> $P/webkit-md-prose-nohas.log
N --browser chromium --kind md-prose --sizes 20k,120k,500k,1m,2m,4m --json $P/chromium-md-prose.json > /dev/null 2> $P/chromium-md-prose.log
N --browser chromium --kind md-dense --sizes 250k,1m --json $P/chromium-md-dense.json > /dev/null 2> $P/chromium-md-dense.log
N --browser webkit --mode ro --json $P/webkit-ro.json > /dev/null 2> $P/webkit-ro.log
N --browser chromium --mode ro --json $P/chromium-ro.json > /dev/null 2> $P/chromium-ro.log
echo done > $P/rest.done
