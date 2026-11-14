#!/bin/bash
# One-glance pipeline status. Run from anywhere: bash /home/jovyan/work/crop_rotation/code/status.sh
cd /home/jovyan/work/crop_rotation || exit 1

echo "== running =="
ps -eo pid,etime,pcpu,rss,args | grep -E "run\.py step|code/(points|gee|hrl|weather|manifest)\.py" \
  | grep -v grep | awk '{printf "  pid %s  elapsed %s  cpu %s%%  rss %sKB  %s\n",$1,$2,$3,$4,substr($0,index($0,$5))}'
ps -eo args | grep -E "run\.py step|code/(points|gee|hrl|weather|manifest)\.py" | grep -v grep >/dev/null \
  || echo "  nothing running"

echo "== core tables =="
for f in data/interim/strata_counts.parquet data/interim/points.parquet data/interim/crops.parquet; do
  if [ -f "$f" ]; then printf "  %-42s %8s\n" "$f" "$(du -h "$f" | cut -f1)"
  else printf "  %-42s %8s\n" "$f" "absent"; fi
done

echo "== rasters =="
n=$(find data/interim/hrl -name '*.tif' 2>/dev/null | wc -l | tr -d ' ')
echo "  tiles: $n  size: $(du -sh data/interim/hrl 2>/dev/null | cut -f1)"

echo "== raw datasets =="
found=0
for d in data/raw/*/; do
  [ -d "$d" ] || continue
  found=1
  echo "  $(basename "$d"): $(ls "$d" | wc -l | tr -d ' ') parts, $(du -sh "$d" | cut -f1)"
done
[ "$found" = 0 ] && echo "  none"

echo "== logs (last 3 lines each) =="
for L in logs/*.log; do
  [ -f "$L" ] || continue
  echo "--- $L"
  tail -3 "$L" | sed 's/^/    /'
done
