# Orchestration for the Bombadil property-based test demo.
#
#   make test       - web + TUI suites, combined terminal report
#   make test-web   - web suite only
#   make test-tui   - TUI suite only
#   make serve      - just serve the web app on :8080
#   make clean      - remove traces, logs and the TUI binary
#
# Knobs: TIME=30s HEADLESS=0 PORT=8080

SHELL := /bin/bash

TIME ?= 30s
HEADLESS ?= 1
PORT ?= 8080

export TIME_LIMIT = $(TIME)
export HEADLESS
export PORT

.PHONY: all test test-web test-tui build serve clean

all: test

test: build
	./scripts/run-tests.sh all

test-web: build
	./scripts/run-tests.sh web

test-tui: build
	./scripts/run-tests.sh tui

build:
	@if [ ! -x node_modules/.bin/bombadil ]; then npm install --no-fund --no-audit; fi
	go -C tui build -o bin/bmbdl .

serve:
	node scripts/serve.mjs

clean:
	rm -rf traces tui/bin
