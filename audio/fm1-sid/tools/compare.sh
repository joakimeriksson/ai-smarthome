#!/bin/sh
# Record every demo piece's register stream and play it on every engine:
#   build/cmp/<piece>.sidlog, build/cmp/<piece>.<engine>.wav, build/cmp/cost.txt (host ms per s)
# Then tools/listen.py builds the level-matched listening set.
set -eu
cd "$(dirname "$0")/.."
mkdir -p build/cmp
build/sid_record record build/cmp > /dev/null
: > build/cmp/cost.txt
for log in build/cmp/*.sidlog; do
    p="${log%.sidlog}"
    [ "$(basename "$p")" = workload ] && continue
    echo "== $(basename "$p")" | tee -a build/cmp/cost.txt
    build/sid_replay "$log" "$p" | tee -a build/cmp/cost.txt
done
