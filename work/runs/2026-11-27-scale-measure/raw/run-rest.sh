cd /d/Dev/marxy-wt/scale-measure; R=work/runs/2026-11-27-scale-measure/raw
m(){ n=$1; shift; node scripts/measure-scale.mjs "$@" --json $R/$n.json > $R/$n.txt 2> $R/$n.log; }
m chromium-md-r2 --kinds md-prose --sizes 250k,500k --cap 120
m chromium-md-r3 --kinds md-prose --sizes 250k,500k --cap 120
m chromium-other --kinds txt,json-pretty,csv,log --sizes 1m,2m,4m --steps open,key,scrollEnd,toSource,find --cap 60
m webkit-md --browser webkit --kinds md-prose --sizes 250k,500k,1m --steps open,key,scrollEnd,toSource,find --cap 90
m msedge-md --browser msedge --kinds md-prose --sizes 250k,500k --cap 120
echo done > $R/rest.done
