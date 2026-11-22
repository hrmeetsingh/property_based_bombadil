# Orchestrates the two apps and their Bombadil property-based tests.
#
#   make test        run both suites, then one combined report
#   make test-web    only the web form suite
#   make test-tui    only the TUI suite
#
# Settings: make test TIME_LIMIT=1m WEB_PORT=5174

TIME_LIMIT ?= 30s
WEB_PORT   ?= 5173
export TIME_LIMIT WEB_PORT

BOMBADIL := node_modules/.bin/bombadil
TUI_BIN  := bin/stocktui
TUI_SRC  := $(wildcard tui/*.go) tui/go.mod tui/go.sum tui/prices.json

.PHONY: help deps build run-web run-tui test test-web test-tui report inspect-web trace-tui clean

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-12s %s\n", $$1, $$2}'

deps: $(BOMBADIL) ## Install Bombadil (npm) and Go modules
	cd tui && go mod download

$(BOMBADIL): package.json package-lock.json
	npm ci
	@touch $@

build: $(TUI_BIN) ## Build the TUI binary

$(TUI_BIN): $(TUI_SRC)
	@mkdir -p bin
	cd tui && go build -o ../$(TUI_BIN) .

run-web: ## Serve the web form at http://127.0.0.1:$(WEB_PORT)/
	PORT=$(WEB_PORT) node web/server.mjs

run-tui: $(TUI_BIN) ## Run the TUI (q to quit)
	./$(TUI_BIN)

test: $(BOMBADIL) $(TUI_BIN) ## Run both suites and print a combined report
	@scripts/run-suite.sh web
	@scripts/run-suite.sh tui
	@node scripts/report.mjs web tui

test-web: $(BOMBADIL) ## Run only the web suite
	@scripts/run-suite.sh web
	@node scripts/report.mjs web

test-tui: $(BOMBADIL) $(TUI_BIN) ## Run only the TUI suite
	@scripts/run-suite.sh tui
	@node scripts/report.mjs tui

report: ## Print the report again for the last run(s)
	@node scripts/report.mjs $(or $(SUITES),web tui)

inspect-web: ## Open the last web trace in Bombadil Inspect
	$(BOMBADIL) browser inspect results/web.trace

trace-tui: ## Print every screen of the last TUI trace
	$(BOMBADIL) trace results/tui.trace --screen

clean: ## Remove build output and results
	rm -rf bin results
