#!/bin/bash
# rip-doctor.sh - check everything the rip/measure loop depends on and say
# exactly how to fix whatever is missing.
#
#   make doctor
#
# Every check here corresponds to a failure that has actually cost debugging
# time, usually because the symptom pointed somewhere else entirely.
cd "$(dirname "$0")/.."
ok=0; bad=0
pass() { printf "  \033[32mOK\033[0m   %s\n" "$1"; ok=$((ok+1)); }
fail() { printf "  \033[31mFAIL\033[0m %s\n     -> %s\n" "$1" "$2"; bad=$((bad+1)); }
warn() { printf "  \033[33mWARN\033[0m %s\n     -> %s\n" "$1" "$2"; }

echo "rip toolchain:"

# 1. Dev server. rip-roundtrip drives a real browser against it; when it is
#    down playwright reports a connection error that reads like a browser bug.
if curl -s -o /dev/null --max-time 3 http://localhost:8471/sid-ripper.html; then
    pass "dev server on :8471"
else
    fail "dev server on :8471 is down" "run 'make serve' (in another shell)"
fi

# 2. HVSC proxy. The corpus is fetched through tools/serve.py, which caches
#    into hvsc-cache/. Without network AND without cache, rips fetch nothing.
if [ -d hvsc-cache/MUSICIANS ]; then
    n=$(find hvsc-cache -name '*.sid' 2>/dev/null | wc -l | tr -d ' ')
    pass "hvsc-cache present ($n .sid cached)"
else
    warn "no hvsc-cache yet" "first rip of each tune downloads it via the proxy (needs network)"
fi

# 3. playwright. Installed in the REPO ROOT's node_modules, not here.
if node -e "require.resolve('playwright')" >/dev/null 2>&1; then
    pass "playwright module resolves"
else
    fail "playwright not installed" "cd ../.. && npm install playwright"
fi
if ls ~/Library/Caches/ms-playwright/webkit-* >/dev/null 2>&1 \
   || ls ~/.cache/ms-playwright/webkit-* >/dev/null 2>&1; then
    pass "playwright webkit browser present"
else
    fail "no webkit browser for playwright" "npx playwright install webkit"
fi

# 4. numpy - for the AUDIO-level metric. The trap: an active virtualenv
#    earlier in PATH shadows the interpreter that has numpy, and the only
#    symptom is spectral-compare printing nothing under the renders.
PY=""
for cand in python3 /usr/bin/python3 /opt/homebrew/bin/python3; do
    if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import numpy' >/dev/null 2>&1; then
        PY="$cand"; break
    fi
done
if [ -n "$PY" ]; then
    if [ "$PY" != "python3" ]; then
        warn "default python3 has NO numpy (venv shadowing?); using $PY" \
             "tools/rip-audio.sh probes for this automatically - direct spectral-compare.py calls need PYTHON=$PY"
    else
        pass "python3 has numpy"
    fi
else
    fail "no python3 with numpy" "pip3 install numpy   (matplotlib too, for --plot)"
fi

# 5. sidplayfp - renders both sides of the audio comparison.
if [ -x tools/bin/sidplayfp ]; then
    pass "tools/bin/sidplayfp present"
else
    fail "tools/bin/sidplayfp missing" "see CLAUDE.md - built against brew libsidplayfp"
fi

# 6. Engine parity gate must still be available.
if [ -f tools/verify.sh ] && ls tests/golden/*.json.gz >/dev/null 2>&1; then
    pass "engine parity suite + golden dumps present (make verify)"
else
    fail "verify harness incomplete" "check tools/verify.sh and tests/golden/"
fi

echo
if [ "$bad" -eq 0 ]; then
    echo "all $ok checks passed - 'make guards' will run the rip corpus"
else
    echo "$bad check(s) failed - fix those before trusting rip measurements"
    exit 1
fi
