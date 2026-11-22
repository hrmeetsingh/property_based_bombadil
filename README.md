# Property-based testing with Bombadil

This repo shows [Bombadil](https://antithesishq.github.io/bombadil/) testing two small apps with property-based tests:

- **web/**: an onboarding form (first name, last name, email, address) with client-side validation, a success summary and a toast in the top-right corner. It is a static page built for desktop.
- **tui/**: a Go terminal app (Bubble Tea) that draws a 30-day line chart for a fictional stock, ACME. The arrow keys pick a day. The chart marks that day's price and draws a dotted line from the x-axis up to it.

Each app has one Bombadil spec in **specs/**. A Makefile runs the apps and the specs, and prints one combined report in the terminal. The branch `opus-5.5-failing` adds bugs that still compile, so you can watch the properties catch them.

## Quick start

You need macOS (Apple Silicon) or Linux, Node 18+, Go 1.22+ and Google Chrome. Bombadil only ships binaries for macOS arm64 and Linux.

```sh
make deps      # npm ci (installs Bombadil 0.8.0) + go mod download
make test      # both suites, about a minute, then the combined report
```

## What is property-based testing?

An example-based test checks one case you wrote down: "type `Ada`, `Lovelace`, `ada@example.com`, `1 Infinite Loop`, click submit, expect *Welcome aboard, Ada Lovelace!*". It passes or fails for that one input. Bugs in the cases you didn't think of go unnoticed.

A property-based test states a rule that must hold for **every** input and every sequence of actions, for example "a touched field shows an error exactly when its value is invalid". The tool then generates the inputs. Bombadil does this for user interfaces. It runs a loop:

1. read the current state of the page or terminal (through **extractors**),
2. check every **property** against it,
3. pick a random action from the **action generators** (clicks, typing, key presses) and perform it,
4. wait for the UI to settle, then go back to step 1.

Properties are written in TypeScript using temporal operators:

| Operator | Meaning |
|---|---|
| `always(p)` | `p` holds now and in every later state (an invariant) |
| `eventually(p).within(5, "seconds")` | `p` becomes true within 5 seconds (a guarantee) |
| `next(p)` | `p` holds in the next state, after the next action |
| `now(() => ...)` | evaluate once in this state, to capture "before" values for `next`/`eventually` |
| `a.implies(b)`, `.and`, `.or`, `not` | combine formulas |

When a property fails, Bombadil records a **trace**: every state, action and screenshot (or terminal screen) up to the failure. You can replay it, inspect it, or shrink it to a shorter failing sequence.

## How the project is set up

```
Makefile               runs everything (see `make help`)
package.json           pins @antithesishq/bombadil 0.8.0
web/
  index.html           the form, success panel and toast container
  app.js               validation rules, submit, toast logic
  styles.css           desktop layout; toasts fixed to the top-right
  server.mjs           zero-dependency static server (port 5173)
tui/
  main.go, model.go    Bubble Tea program: key handling and status line
  chart.go             draws the chart; layout constants
  data.go, prices.json the fictional prices (embedded into the binary)
specs/
  web.spec.ts          Bombadil spec for the form (browser driver)
  tui.spec.ts          Bombadil spec for the chart (terminal driver)
scripts/
  run-suite.sh         starts an app, runs Bombadil, saves results/
  report.mjs           combined terminal report from the traces
results/               (git-ignored) logs, traces and exit codes per suite
```

### The web app and its test

`make run-web` serves the form at http://127.0.0.1:5173/. The rules are:

- first and last name: 1 to 50 characters after trimming; letters, spaces, hyphens and apostrophes; must start with a letter
- email: `name@domain.tld`, no spaces, at most 254 characters
- address: 5 to 200 characters after trimming

A field shows its error once it is touched (typed in, left, or the form was submitted). A valid submit shows a summary, pops a toast in the top-right corner for 3 seconds (at most three toasts at a time), and resets the form.

`make test-web` starts the server, then runs `bombadil browser test` headless at 1280×800 against `specs/web.spec.ts` for 30 seconds. It stops at the first violation. The spec:

- **re-states the rules on its own.** The spec does not import `app.js`. It is the oracle, so if the app disagrees with it, a property fails.
- **extracts** each field's value, touched flag and visible error, the success panel, and every toast's text and position.
- **generates actions:** a custom `fill` action that puts good or bad sample values into a field (weighted towards good ones, so valid submits happen often), clicks on the submit button, and Bombadil's default random `inputs` and `clicks`. Reload and back/forward are left out, because a reload would hide a toast that never goes away.

### The TUI and its test

`make run-tui` builds and starts the chart. Keys: `←`/`h` previous day, `→`/`l` next day, `Home`/`g` first day, `End`/`G` last day, `q` quit.

`make test-tui` runs `bombadil terminal test` on `bin/stocktui` in a 100×30 virtual terminal against `specs/tui.spec.ts` for 30 seconds. The spec:

- **imports `tui/prices.json`**, the same file the Go binary embeds, to know which price each day must show.
- **reads the screen** through `state.grid.rowText(row)` and derives small cells from it: the selected day, each day's plotted row, the marker, and the dotted cells.
- **presses keys** (`l`, `h`, arrows, `g`, `G`, Home, End, and keys that should be ignored). It never presses `q`, because the run ends when the program exits.
- **uses `--quiescence-timeout-ms 50`.** Bubble Tea redraws on a 60 fps ticker, so after a key press the frame can arrive up to about 16 ms later. With Bombadil's default of 5 ms, the screen was sometimes read before the redraw. Waiting for 50 ms of silence means each state shows the frame for the key just pressed.

## Invariants being tested

### Web form (`specs/web.spec.ts`)

| Property | Rule |
|---|---|
| `errorShownIffInvalid` | A touched field shows an error **if and only if** its value breaks the rule. An untouched field shows none. |
| `successShowsOnlyValidValues` | The success summary only ever shows values that pass every rule. |
| `validSubmitSucceeds` | Clicking submit while every field is valid leads, within 2 s, to a new success summary and a toast naming the email. |
| `invalidSubmitRejected` | Clicking submit while any field is invalid never counts as a submission. |
| `toastInTopRight` | Every toast lies in the top-right quarter of the viewport. |
| `toastDisappears` | Every toast is gone within 5 s of being seen. |
| `noConsoleErrors`, `noHttpErrorCodes`, `noUncaughtExceptions`, `noUnhandledPromiseRejections` | Bombadil's default browser properties. |

### Stock chart TUI (`specs/tui.spec.ts`)

| Property | Rule |
|---|---|
| `selectionInRange` | The selected day is always between 1 and 30. |
| `statusMatchesData` | The status line shows the selected day's real date and price. |
| `lineMatchesPrices` | Every day's price is plotted exactly once, on the row its price maps to. |
| `markerOnSelectedDay` | There is exactly one marker `●`, on the selected day's price. |
| `dottedLineTouchesPoint` | The dotted line `┊` fills every cell from just above the x-axis up to the marker, and appears nowhere else. |
| `navigationStateMachine` | After each key, the selection is exactly where that key should put it: ±1 and stopping at the edges, first/last day, or unchanged for other keys. |
| `exitSuccess`, `noReplacementChars` | Bombadil's default terminal properties. |

## Running the tests

| Command | What it does |
|---|---|
| `make test` | both suites, then one combined report |
| `make test-web` | only the web form |
| `make test-tui` | only the TUI |
| `make report` | print the last report again (`SUITES=web` for one) |
| `make inspect-web` | open the last web trace in Bombadil Inspect |
| `make trace-tui` | print every screen of the last TUI trace |
| `make test TIME_LIMIT=2m` | explore for longer |
| `make test WEB_PORT=5174` | use another port for the form |

`make` exits non-zero when any suite fails. The report decides pass or fail from the violations in each trace, not from Bombadil's exit code alone, because the terminal driver exits 1 (not the documented 2) when it finds a violation.

On `opus-5.5` the report looks like this:

```
Bombadil property-based test report
────────────────────────────────────────────────────────────────────────
Suite   Result    Explored      Actions   Time
web     PASS      1055 states   1054      28.6s
tui     PASS      273 states    272       29.0s
────────────────────────────────────────────────────────────────────────
web  PASS  specs/web.spec.ts
  ✓ errorShownIffInvalid
  ✓ successShowsOnlyValidValues
  ...
Overall: PASS  2 of 2 suite(s) passed
```

A pass means no violation was found in 30 seconds of random exploration. It is evidence, not proof. Runs are random, so two runs explore different paths. Raise `TIME_LIMIT` to search harder.

### Running the failing branch

```sh
git checkout opus-5.5-failing
make test          # fails: each suite reports the property it broke
git checkout opus-5.5
```

That branch has four bugs, one commit each (see `git log opus-5.5..opus-5.5-failing`):

| App | Bug | Property that catches it |
|---|---|---|
| web | the last name is only checked for being non-empty | `errorShownIffInvalid` |
| web | a new toast cancels the previous toast's dismiss timer | `toastDisappears` |
| tui | the right-edge check uses the day count instead of the last index, so "Day 31" can be selected | `selectionInRange` (and `navigationStateMachine`) |
| tui | the dotted line stops one row below the marker | `dottedLineTouchesPoint` |

The run stops at the first violation, so `make test` on that branch shows one failing property per suite: the bug Bombadil finds first. The report shows the action that led there and Bombadil's explanation:

```
web  FAIL  specs/web.spec.ts
  ✗ errorShownIffInvalid
      first violated at state #54 (1.280s), after fill("lastName", "<b>Bold</b>")
      however at 00:01.280: errorMismatches = - error: null field: lastName touched: true value: "<b>Bold</b>"
...
tui  FAIL  specs/tui.spec.ts
  ✗ dottedLineTouchesPoint
      first violated at state #0 (0.000s), in the initial state
      however at 00:01.101, drawn = true, selectedDay = 1.0, dottedCells = []
```

## Fixing the failing tests

Take the TUI's dotted line. The report says that on day 1 the property expected dotted cells, but `dottedCells = []`. Replay the run to see the screen:

```sh
npx bombadil trace results/tui.trace --screen
```

The marker `●` is there, but nothing joins it to the axis. In `tui/chart.go` the loop runs `row > markerRow+1` instead of `row > markerRow`. Fix that one comparison and run `make test-tui` again. `dottedLineTouchesPoint` passes, and the next bug shows up: `selectionInRange` reports `selectedDay = 31.0` after a right-arrow press. Fix that one (`m.selected < last` in `tui/model.go`) and the TUI suite is green. The web suite works the same way: restore `nameError` for the last name, then the per-toast timer.

How this differs from a regular test:

- **You fix the app, never the test.** The property states the rule. It doesn't know about day 1, "Day 31" or `<b>Bold</b>`. Bombadil found those inputs itself.
- **One property covers cases nobody wrote.** An example test for the dotted line would check one or two chosen days. The property checks every day the random walk visits, after any key sequence. The "Day 31" bug needs a key sequence that ends on day 30 followed by →. Nobody wrote that case; the random walk produced it.
- **Fixing one bug can reveal the next.** Bombadil stops at the first violation, so bugs appear one at a time, in the order the exploration reaches them.
- **Bombadil finds real bugs too.** While this repo was being built, `toastInTopRight` failed on the main branch: six quick valid submits stacked toasts below the top half of the screen. That led to the three-toast cap and the single-line toasts, a case no one had planned for.

## Notes and limits

- The terminal driver is marked experimental in Bombadil 0.8.0, and it has no custom actions, so keys are sent as `TypeText` escape sequences (`\x1b[C` is →).
- `always`, `eventually`, `next` and `now` must be imported from `@antithesishq/bombadil`. The npm README's example imports `always` from `@antithesishq/bombadil/browser`, and that import fails at runtime.
- The intended remote is https://github.com/hrmeetsingh/property_based_bombadil. Nothing in this repo has been pushed.
