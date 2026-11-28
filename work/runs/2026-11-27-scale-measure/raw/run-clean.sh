cd /d/Dev/marxy-wt/scale-measure; R=work/runs/2026-11-27-scale-measure/raw
m(){ n=$1; shift; node scripts/measure-scale.mjs "$@" --json $R/$n.json > $R/$n.txt 2> $R/$n.log; }
m chromium-md-r2 --kinds md-prose --sizes 250k,500k --steps open,key,toSource,find --cap 60
m chromium-md-r3 --kinds md-prose --sizes 250k,500k --steps open,key,toSource,find --cap 60
m webkit-md --browser webkit --kinds md-prose --sizes 250k,500k --steps open,key,toSource,find --cap 60
m msedge-md --browser msedge --kinds md-prose --sizes 250k,500k --steps open,key,toSource,find --cap 60
echo done > $R/clean.done
