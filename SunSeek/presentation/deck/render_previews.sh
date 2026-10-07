#!/bin/bash
# renders deck/<name>.html -> deck/<name>_preview.png (1920x1080) with headless Edge. usage: ./render_previews.sh [name ...]  (no args = all pages)
cd "$(dirname "$0")"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
names=("$@"); [ ${#names[@]} -eq 0 ] && names=(cover team vehicle physics ours turns blackbox filter compass tuning lessons kicks fixes fuzz loop drift stop web mission2)
for n in "${names[@]}"; do
  "$EDGE" --headless --disable-gpu --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=8000 \
    --screenshot="$(cygpath -w "$PWD/${n}_preview.png")" "file:///$(cygpath -m "$PWD/${n}.html")" 2>&1 | grep -i "written" | sed "s/^/$n: /"
done
