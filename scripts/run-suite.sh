#!/usr/bin/env bash
# Run one Bombadil suite and record its results in results/:
#   results/<suite>.log    everything Bombadil printed
#   results/<suite>.trace  the trace file (states, actions, violations)
#   results/<suite>.exit   Bombadil's exit code
# This script always exits 0; scripts/report.mjs decides pass or fail.
#
# Usage: scripts/run-suite.sh web|tui
# Settings (environment): TIME_LIMIT (default 30s), WEB_PORT (default 5173)
set -u

suite="${1:?usage: run-suite.sh web|tui}"
root="$(cd "$(dirname "$0")/.." && pwd)"
results="$root/results"
bombadil="$root/node_modules/.bin/bombadil"
time_limit="${TIME_LIMIT:-30s}"
port="${WEB_PORT:-5173}"

mkdir -p "$results"
rm -f "$results/$suite.log" "$results/$suite.trace" "$results/$suite.exit"
log="$results/$suite.log"
trace="$results/$suite.trace"

if [ ! -x "$bombadil" ]; then
  echo "Bombadil is not installed; run 'make deps' first." | tee "$log"
  echo 1 > "$results/$suite.exit"
  exit 0
fi

case "$suite" in
  web)
    if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
      echo "Port $port is already in use; stop that server or set WEB_PORT." | tee "$log"
      echo 1 > "$results/$suite.exit"
      exit 0
    fi
    PORT="$port" node "$root/web/server.mjs" > "$results/web-server.log" 2>&1 &
    server=$!
    trap 'kill "$server" 2>/dev/null; wait "$server" 2>/dev/null' EXIT
    for _ in $(seq 1 50); do
      curl -s -o /dev/null "http://127.0.0.1:$port/" && break
      sleep 0.1
    done
    echo "web: testing http://127.0.0.1:$port/ for $time_limit ..."
    "$bombadil" browser test \
      --headless --exit-on-violation --time-limit "$time_limit" \
      --width 1280 --height 800 \
      --output-path "$trace" --output-path-overwrite \
      "http://127.0.0.1:$port/" "$root/specs/web.spec.ts" > "$log" 2>&1
    code=$?
    ;;
  tui)
    echo "tui: testing bin/stocktui for $time_limit ..."
    # quiescence: wait 50ms of terminal silence before reading the screen,
    # so a frame from Bubble Tea's renderer is never half drawn or late.
    "$bombadil" terminal test \
      --specification "$root/specs/tui.spec.ts" \
      --exit-on-violation --time-limit "$time_limit" \
      --columns 100 --rows 30 --quiescence-timeout-ms 50 \
      --output-path "$trace" --output-path-overwrite \
      -- "$root/bin/stocktui" > "$log" 2>&1
    code=$?
    ;;
  *)
    echo "unknown suite: $suite (expected web or tui)" >&2
    exit 1
    ;;
esac

echo "$code" > "$results/$suite.exit"
echo "$suite: finished (bombadil exit code $code, log in results/$suite.log)"
exit 0
