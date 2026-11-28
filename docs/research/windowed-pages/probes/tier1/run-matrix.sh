#!/bin/sh
# Sequential matrix: one browser at a time. Run from a checkout of the app (scripts/tier1-probe.mjs lives there).
# usage: sh run-matrix.sh <outdir>
OUT=${1:-.}
run() { # browser kind mb mode runs cap
  f="$OUT/$1-$2-$3mb-$4.json"
  node scripts/tier1-probe.mjs --browser $1 --kind $2 --mb $3 --mode $4 --runs $5 --cap $6 --out "$f" > "$f.log" 2>&1
}
for b in chromium webkit; do
  for m in off bytes tag nosize; do run $b md-prose 0.25 $m 3 90; done
done
for b in chromium webkit; do
  for m in off bytes; do run $b md-prose 1 $m 2 180; done
done
for b in chromium webkit; do
  for k in md-dense md-technical; do for m in off bytes; do run $b $k 1 $m 1 180; done; done
done
for b in chromium webkit; do
  for mb in 2 4.9; do for m in off bytes; do run $b md-prose $mb $m 1 180; done; done
done
echo done > "$OUT/MATRIX_DONE"
