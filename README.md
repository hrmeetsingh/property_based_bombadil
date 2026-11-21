# property_based_bombadil

A demonstration project for **[Bombadil](https://antithesishq.github.io/bombadil/)** —
property-based testing for user interfaces — built around two small apps:

| App | What it is | Bombadil driver |
| --- | --- | --- |
| `web/` | A static **onboarding form** (first name, last name, email, address) with client-side validation, a success panel and a top-right toast | `bombadil browser` |
| `tui/` | A Go **stock-performance TUI** (Bubble Tea) that draws a fictional stock (`BMBDL`) as a line graph with keyboard-driven day selection | `bombadil terminal` |

Both apps are exercised by **property-based tests**: instead of fixed
example cases, the suite states *invariants that must hold in every state*,
and Bombadil autonomously explores the app — random clicks, typing, key
presses, weird sequences of actions — checking the invariants as it goes.

---

## Quick start

Prerequisites: **Node 20+**, **Go 1.24+**, **make**, **Google Chrome**
(for the browser driver).

```sh
make test        # run web + TUI suites, print the combined report
make test-web    # web suite only
make test-tui    # TUI suite only
```

First run installs the npm dependency (`@antithesishq/bombadil`) and builds
the TUI binary automatically. Typical output:

```
==============================================================================
 Bombadil property-based test report
 2026-11-21 22:05:51 UTC
==============================================================================
 Suite             Result      Violations   Duration  Trace
 ------------------------------------------------------------------------------
 web (browser)     PASS                 0        30s  traces/web-20261121-160451.bin
 tui (terminal)    PASS                 0        30s  traces/tui-20261121-160451.bin
==============================================================================
 OVERALL: PASS (2/2 suites green)
==============================================================================
```

Knobs (env vars or make variables): `TIME=30s`, `HEADLESS=0` (show the
Chrome window), `PORT=8080`, `QUIESCENCE_MS=50`.

---

## A quick introduction to property-based tests

A *regular (example-based) test* encodes one scenario:

> "Given the email `bad@`, when I click Submit, then the email error appears."

That example only proves one point in a vast state space — and it must be
maintained by hand forever.

A *property-based test* encodes a rule that must hold **for every state the
app can reach**:

> "Whenever the success panel is visible, every field holds a valid value."

Bombadil generates the scenarios: it explores the app chaotically (typing
junk, clicking around, submitting in strange orders), captures the app state
after every interesting event, and checks every exported property against
each state. When a property breaks, the trace records the exact sequence of
actions that led there (`bombadil trace <file> --screen`, `--reproduce`).

Properties are written in TypeScript using temporal operators:

```ts
// "In every state ..." - an invariant
export const errorsOnlyShownForInvalidFields = always(() =>
  fieldInfo.current.every((f) => !f.errorVisible || !f.valid),
);

// "... and a visible toast always disappears again" - a guarantee
export const toastEventuallyHides = always(
  now(() => toastInfo.current.visible).implies(
    eventually(() => !toastInfo.current.visible).within(8, "seconds"),
  ),
);

// "The selection only ever moves one day at a time" - a state machine
export const dayMovesOneStepAtATime = always(/* current day vs. next day */);
```

---

## How the project is set up

```
├── Makefile                 # orchestration entry points
├── package.json             # devDependency: @antithesishq/bombadil
├── web/                     # static app (no build step)
│   ├── index.html           #   form + success panel + toast
│   ├── styles.css           #   desktop layout (1024px), toast top-right
│   └── app.js               #   validation model + submit/reset logic
├── tui/                     # Go app (Bubble Tea)
│   ├── main.go              #   stock chart renderer + key handling
│   ├── stock.json           #   30 fictional daily close prices
│   └── go.mod / go.sum
├── bombadil/
│   ├── web.spec.ts          # browser driver: properties + actions
│   └── tui.spec.ts          # terminal driver: properties + actions
├── scripts/
│   ├── serve.mjs            # dependency-free static file server
│   ├── run-tests.sh         # orchestrator: deps, server, suites, report
│   └── report.mjs           # combined terminal report
└── traces/                  # test artifacts (gitignored)
```

### The apps

**Web app** — a plain HTML/CSS/JS page. `app.js` owns the validation model:
every field is required, `email` must match a conventional pattern, errors
are shown only for *touched & invalid* fields and clear as soon as the value
becomes valid. Submitting valid values hides the form, shows the success
panel and raises a toast that auto-dismisses after 4s. Submitting invalid
values keeps the form up and marks the offending fields.

**TUI app** — `tui/main.go` renders each frame into a full terminal-sized
rune canvas (so no line ever wraps or leaves stale characters at any terminal
size). Layout: title row, status line `Day: 07/30  Close: $149.40`, the plot
with the price line (`.`), the selected day's point (`*`), a vertical dotted
line (`:`) from the x-axis up to that point, and an x-axis whose selected day
is bracketed (`[07]`).

Key mappings:

| Key | Effect |
| --- | --- |
| `←` / `h` | select the previous day (clamped at day 0) |
| `→` / `l` | select the next day (clamped at day 29) |
| `q` / `Ctrl+C` | quit with exit code 0 |
| anything else | ignored |

The day index is **0-based** everywhere (status line, axis labels, dataset).

### How the tests are set up

Each app gets one Bombadil **specification** that exports *properties*
(invariants/guarantees) and *action generators* (how Bombadil should poke the
app). Actions are randomized with weights, so every run explores differently.

#### Web invariants — `bombadil/web.spec.ts`

| Property | Invariant |
| --- | --- |
| `successRequiresValidData` | Whenever the success panel is visible, **every field holds a valid value** (spec-side validation contract, independent of the implementation). |
| `errorsOnlyShownForInvalidFields` | A visible field-error message **implies that field is currently invalid**. |
| `toastIsTopRight` | Whenever the toast is visible, it sits in the **top-right quadrant** of the viewport. |
| `toastEventuallyHides` | **Guarantee:** a visible toast always disappears again (within 8s). |
| `noUncaughtExceptions` *(default)* | No uncaught JS exceptions during exploration. |
| `noUnhandledPromiseRejections` *(default)* | No unhandled promise rejections. |
| `noConsoleErrors` *(default)* | No `console.error` output. |
| `noHttpErrorCodes` *(default)* | No HTTP 4xx/5xx responses (the static server only ever serves 200s). |

Actions: Bombadil's default **click / type / scroll** generators, plus two
custom actions that drive the interesting flows directly —
`submitWith("valid" | "invalidEmail" | "empty")` and `resetRegistration()` —
guarded so they only fire when the form / success panel is on screen.
(The `reload` default is deliberately excluded: a reload resets the UI
state and would silently satisfy `toastEventuallyHides` without the app
ever hiding the toast itself.)

#### TUI invariants — `bombadil/tui.spec.ts`

| Property | Invariant |
| --- | --- |
| `titleAlwaysVisible` | Once the app has rendered a frame, row 0 shows the ticker title. |
| `selectedDayInRange` | The selected day index is always inside the dataset, and the total always equals `stock.json`'s length (30). |
| `dayMovesOneStepAtATime` | **State machine:** between two consecutive states the selection may stay, move `+1`, or move `-1` — never jump. |
| `priceAlwaysMatchesSelection` | The `Close:` price shown **always equals `stock.json[day]`** (down to the cent). |
| `axisMarkerMatchesSelection` | The bracketed x-axis label always marks the same day as the status line. |
| `dottedLineAtSelectedColumn` | The vertical dotted line always sits at the x-axis column `round(day × (cols-1) / 29)` of the selected day. |
| `exitSuccess` *(default)* | The app never dies with a non-zero exit code (a crash/panic = violation). |
| `noReplacementChars` *(default)* | The app never emits malformed UTF-8. |

Actions: single keystrokes only, so every captured state transition is caused
by exactly one key — `[hl]`, the arrow escape sequences `\x1b[D` / `\x1b[C`,
and random printable junk (no control characters) that the app must swallow
without crashing. `q` is deliberately never generated: it would end the run
immediately (it remains part of the manual flow).

---

## Running the tests

| Goal | Command |
| --- | --- |
| Both suites, combined report | `make test` |
| Web app only | `make test-web` |
| TUI only | `make test-tui` |
| Longer exploration (e.g. 2 minutes per app) | `make test TIME=2m` |
| Watch Chrome while testing | `make test-web HEADLESS=0` |

The orchestrator (`scripts/run-tests.sh`) builds the TUI, starts the static
server on `:8080` for the web run (reused if already up, shut down on exit),
runs each suite with its own trace + log, and hands the results to
`scripts/report.mjs`, which prints the combined table above. Exit codes
follow Bombadil: `0` green, `2` violations, `1` error — so `make test`
fails the build when any suite is red.

Artifacts per run land in `traces/`:

```sh
./node_modules/.bin/bombadil trace traces/web-<stamp>.bin --screen   # replay states in the terminal
./node_modules/.bin/bombadil trace traces/tui-<stamp>.bin --state 40..60
make clean                                                           # remove traces/logs/binary
```

---

## The failing branch

The branch **`failing-demo`** keeps both apps compiling and runnable but
breaks their invariants on purpose:

- **web:** email validation is loosened (any string containing `@` passes)
  → the success panel can appear with an invalid email
  → `successRequiresValidData` fails. The toast moves to the bottom-left and
  stops auto-dismissing → `toastIsTopRight` and `toastEventuallyHides` fail.
- **tui:** the right-arrow key advances **two** days →
  `dayMovesOneStepAtATime` fails; the price line renders the wrong column →
  `dottedLineAtSelectedColumn` fails; the status line shows a different
  price than the dataset → `priceAlwaysMatchesSelection` fails.

Run it:

```sh
git checkout failing-demo
make test                 # same command, report turns red
# or one suite: make test-tui
git checkout main         # back to green
```

Expected report on that branch:

```
 Suite             Result      Violations   Duration  Trace
 ------------------------------------------------------------------------------
 web (browser)     FAIL                ...        30s  traces/web-....bin
                   violated properties:
                     - successRequiresValidData (x...)
                     - toastIsTopRight (x...)
                     - toastEventuallyHides (x...)
 tui (terminal)    FAIL                ...        30s  traces/tui-....bin
                   violated properties:
                     - dayMovesOneStepAtATime (x...)
                     - priceAlwaysMatchesSelection (x...)
                     - dottedLineAtSelectedColumn (x...)
 OVERALL: FAIL (0/2 suites green)
```

### Fixing it: property-based vs. example-based testing

On `failing-demo`, run one suite and follow the report — for the TUI:

```sh
make test-tui
./node_modules/.bin/bombadil trace traces/tui-<stamp>.bin --screen | less
```

Each violating state shows the property name and the screen *as the property
saw it*; the actions on the left of each state are the reproduction steps
(`bombadil terminal test --reproduce <trace> -- ./tui/bin/bmbdl` replays
them exactly).

Now compare the two styles of fixing:

- **Example-based mindset:** you'd have to *think of* the case "right arrow
  pressed twice at day 12", write that test by hand, watch it fail, fix, and
  repeat for every other scenario you can imagine. The bug you didn't think
  of stays in production.
- **Property-based mindset:** you never wrote a single scenario. Bombadil
  *found* a sequence you didn't imagine, reported the violated invariant
  (`dayMovesOneStepAtATime`) with its replayable trace, and after you fix
  the app the very same property re-verifies it across *thousands of random
  states* — not just the one example.

To fix the failing branch, repair the invariants in the **apps** (never the
specs — the specs describe the intended contract):

```sh
git checkout failing-demo
# web: restore the strict EMAIL_PATTERN in web/app.js,
#      move .toast back to top/right, restore the auto-dismiss timer
# tui: in tui/main.go advance by 1 (not 2) on right,
#      render the dotted line at the selected column,
#      print m.prices[day] in the status line
make test                 # green again: the invariants hold over the whole state space
```

That is the essential difference: a regular test tells you one story you
already knew; a property tells you the *rule* and keeps fuzzing the app for
new stories forever.

---

## Version control

- Development happens on `main` (green) and `failing-demo` (red), with
  incremental commits on both.
- The configured remote is `https://github.com/hrmeetsingh/property_based_bombadil`
  — **nothing is pushed**; everything stays local.
