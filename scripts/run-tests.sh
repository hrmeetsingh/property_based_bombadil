#!/usr/bin/env bash
# Orchestrates the Bombadil property-based test runs and prints a combined
# terminal report.
#
#   scripts/run-tests.sh          # run web + TUI, combined report
#   scripts/run-tests.sh web      # run only the web suite
#   scripts/run-tests.sh tui      # run only the TUI suite
#
# Environment knobs:
#   TIME_LIMIT=30s   how long each suite explores (bombadil time-limit syntax)
#   HEADLESS=0       show the Chrome window during the web run
#   PORT=8080        port for the static web server
#   QUIESCENCE_MS=50 terminal state-sampling patience (see test_tui)
set -u

MODE="${1:-all}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BOMBADIL="./node_modules/.bin/bombadil"
TIME_LIMIT="${TIME_LIMIT:-30s}"
HEADLESS="${HEADLESS:-1}"
PORT="${PORT:-8080}"

STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="traces/logs"
RESULTS="$LOG_DIR/results-$STAMP.tsv"
mkdir -p traces "$LOG_DIR"

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

ensure_deps() {
  if [ ! -x "$BOMBADIL" ]; then
    echo "installing npm dependencies..."
    npm install --no-fund --no-audit
  fi
  echo "building TUI..."
  go -C tui build -o bin/bmbdl . || exit 1
}

start_server() {
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then
    echo "reusing static server already listening on :$PORT"
    return 0
  fi
  PORT="$PORT" node scripts/serve.mjs >"$LOG_DIR/server-$STAMP.log" 2>&1 &
  SERVER_PID=$!
  local tries=0
  while [ "$tries" -lt 50 ]; do
    if curl -sf -o /dev/null "http://localhost:$PORT/"; then
      return 0
    fi
    sleep 0.2
    tries=$((tries + 1))
  done
  echo "error: static server did not come up on port $PORT" >&2
  return 1
}

# run_suite <name> <trace-path> <command...>
# Runs the command, captures log/trace/duration, appends a results row.
run_suite() {
  local suite="$1"
  local trace="$2"
  shift 2
  local log="$LOG_DIR/${suite}-${STAMP}.log"
  local start end code duration

  echo ">> running suite: $suite (time-limit $TIME_LIMIT, trace $trace)"
  start=$(date +%s)
  "$@" >"$log" 2>&1
  code=$?
  end=$(date +%s)
  duration=$((end - start))

  printf '%s\t%s\t%s\t%s\t%s\n' "$suite" "$code" "$duration" "$trace" "$log" >>"$RESULTS"
  return 0
}

test_web() {
  local trace="traces/web-${STAMP}.bin"
  # Plain string (not an array): empty-array expansion under `set -u` breaks
  # on the bash 3.2 that macOS ships.
  local headless_flag=""
  if [ "$HEADLESS" = "1" ]; then
    headless_flag="--headless"
  fi
  run_suite web "$trace" "$BOMBADIL" browser test $headless_flag \
    --time-limit "$TIME_LIMIT" \
    --output-path "$trace" \
    "http://localhost:$PORT/" bombadil/web.spec.ts
}

test_tui() {
  local trace="traces/tui-${STAMP}.bin"
  # Bubble Tea's standard renderer repaints at ~60fps, so a frame can lag a
  # keystroke by up to ~17ms. The bombadil default quiescence timeout (5ms)
  # would sample the screen before the frame arrived and make single
  # keystrokes look like multi-day jumps. 50ms safely covers the repaint.
  run_suite tui "$trace" "$BOMBADIL" terminal test \
    --specification bombadil/tui.spec.ts \
    --time-limit "$TIME_LIMIT" \
    --quiescence-timeout-ms "${QUIESCENCE_MS:-50}" \
    --output-path "$trace" \
    -- ./tui/bin/bmbdl
}

case "$MODE" in
  web)
    ensure_deps
    start_server || exit 1
    test_web
    ;;
  tui)
    ensure_deps
    test_tui
    ;;
  all)
    ensure_deps
    start_server || exit 1
    test_web
    test_tui
    ;;
  *)
    echo "usage: $0 [web|tui|all]" >&2
    exit 1
    ;;
esac

node scripts/report.mjs "$RESULTS"
exit $?
