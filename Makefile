# Orchestration for the Bombadil property-based test demo.
#
#   make test       - web + TUI suites, combined terminal report
#   make test-web   - web suite only
#   make test-tui   - TUI suite only
#   make serve      - just serve the web app on :8080
#   make clean      - remove traces, logs and the TUI binary
#
# Knobs: TIME=30s HEADLESS=0 PORT=8080 QUIESCENCE_MS=50

SHELL := /bin/bash

TIME ?= 30s
HEADLESS ?= 1
PORT ?= 8080

export TIME_LIMIT = $(TIME)
export HEADLESS
export PORT

.PHONY: all test test-web test-tui build serve clean

all: test

# The test targets build through run-tests.sh (ensure_deps), so there is a
# single build path; `make build` runs just that step.
test:
	./scripts/run-tests.sh all

test-web:
	./scripts/run-tests.sh web

test-tui:
	./scripts/run-tests.sh tui

build:
	./scripts/run-tests.sh build

serve:
	node scripts/serve.mjs

clean:
	rm -rf traces tui/bin
