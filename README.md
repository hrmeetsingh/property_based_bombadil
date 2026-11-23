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

### Branches at a glance

| Branch | State | What it is |
| --- | --- | --- |
| `main` | green | The original build, later reviewed and extended with Claude Opus 5.5 (this README describes it) |
| `failing-demo` | red | `main` plus two commits that break both apps on purpose |
| `opus-5.5` | green | A separate rebuild from scratch with Claude Opus 5.5, using the same [`project_setup.prompt.md`](project_setup.prompt.md) |
| `opus-5.5-failing` | red | `opus-5.5` plus four small bugs, one commit each |

See [Work done with Claude Opus 5.5](#work-done-with-claude-opus-55) for how
the `opus-5.5*` branches differ from `main` and `failing-demo`.

---

## Quick start

Prerequisites: **Node 20+**, **Go 1.25+** (see `tui/go.mod`), **make**, **Google Chrome**
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

Properties are written in TypeScript with a handful of *temporal
operators*. Read them out loud and they are plain English:

| Operator | Reads as | Used in |
| --- | --- | --- |
| `extract(fn)` | "a value read from the app state" | `dayInfo`, `toastInfo`, `fieldInfo` |
| `.current` | "…that value in the state being checked" | every property |
| `always(p)` | "in **every** state, p" | all properties |
| `now(p)` | "in **this** state, p" | `titleAlwaysVisible` |
| `next(p)` | "in the state **right after** this one, p" | `dayMovesOneStepAtATime`, `keysMoveSelection` |
| `eventually(p).within(n, unit)` | "within n units **from now**, p" | `toastEventuallyHides`, `validSubmitShowsSuccess` |
| `a.implies(b)` / `a.or(b)` | "if a then b" / "a or b" | `validSubmitShowsSuccess` / `titleAlwaysVisible` |

The simplest kind is an *invariant* — a check on one state:

```ts
// "In every state, a visible error implies that field is invalid."
export const errorsOnlyShownForInvalidFields = always(() =>
  fieldInfo.current.every((f) => !f.errorVisible || !f.valid),
);
```

A *guarantee* looks forward in time:

```ts
// "In every state: if the last action was a valid submit, then within
//  2 seconds the success panel and the toast are on screen."
export const validSubmitShowsSuccess = always(
  now(() => lastSubmitMode.current === "valid").implies(
    eventually(() => successVisible.current && toastInfo.current.visible).within(2, "seconds"),
  ),
);
```

[Worked examples](#worked-examples) below walks through a two-state
property line by line.

---

## How the project is set up

```
├── Makefile                 # orchestration entry points
├── project_setup.prompt.md  # the original brief this repo was built from
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
panel and raises a toast that auto-dismisses 5 seconds after it appears
(re-showing an already-visible toast keeps the original deadline, so
overlapping notifications can never pin it on screen). Each appearance is
numbered in the toast's `data-showing` attribute, so the spec can tell a
fresh appearance from one that never went away (see
[Properties only see observed states](#properties-only-see-observed-states)). Submitting invalid
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
| `toastEventuallyHides` | **Guarantee:** every appearance of the toast ends within 8s — it hides, or is replaced by a newer appearance (the app numbers each one in `data-showing`, so a hide-and-reshow between two observed states is not mistaken for one long showing). |
| `validSubmitShowsSuccess` | **Guarantee:** after `submitWith("valid")`, the success panel and the toast appear (within 2s). |
| `invalidSubmitShowsErrors` | Right after an invalid submission the form stays on screen and **every invalid field shows its error**. |
| `noUncaughtExceptions` *(default)* | No uncaught JS exceptions during exploration. |
| `noUnhandledPromiseRejections` *(default)* | No unhandled promise rejections. |
| `noConsoleErrors` *(default)* | No `console.error` output. |
| `noHttpErrorCodes` *(default)* | No HTTP 4xx/5xx responses (the static server answers 200 for every app file; it only returns 403/404 for paths outside `web/` or missing files, which the app never requests). |

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
| `dottedLineAtSelectedColumn` | The vertical dotted line always sits at the x-axis column `round(day × (cols-1) / 29)` of the selected day and runs unbroken from the x-axis up to the `*` point. |
| `keysMoveSelection` | **State machine:** `h`/← selects the previous day, `l`/→ the next (clamped at the ends); any other key leaves the selection unchanged. |
| `exitSuccess` *(default)* | The app never dies with a non-zero exit code (a crash/panic = violation). |
| `noReplacementChars` *(default)* | The app never emits malformed UTF-8. |

Actions: single keystrokes only, so every captured state transition is caused
by exactly one key — `[hl]`, the arrow escape sequences `\x1b[D` / `\x1b[C`,
and random printable junk (no control characters) that the app must swallow
without crashing. `q` is deliberately never generated: it would end the run
immediately (it remains part of the manual flow).

---

## Worked examples

### 1. The same rule, tested both ways

The rule: *the form only accepts a valid email*. An example-based test
picks one input and checks one outcome:

```text
fill first-name = "Ada", last-name = "Lovelace",
     email = "ada@example.com", address = "12 Turing Lane"
click Submit
expect the success panel to be visible            ✔ passes
```

Run that against the [`failing-demo`](#the-failing-branch) branch and it
**still passes**: on that branch the email check is gone, but a valid
email was never going to show it. The test only checks the input someone
thought of.

The property states the rule itself, for whatever is in the fields:

```ts
export const successRequiresValidData = always(() => {
  if (!successVisible.current) return true;
  return fieldInfo.current.every((f) => f.valid);
});
```

Bombadil tries `submitWith("invalidEmail")` (which fills in `not-an-email`)
plus random typing, so on `failing-demo` the report goes red within seconds:
`successRequiresValidData` and `invalidSubmitShowsErrors` are both violated.

### 2. A property read line by line

`keysMoveSelection` (in `bombadil/tui.spec.ts`) says what the keys must do:

```ts
const LEFT_KEYS = ["h", "\u001b[D"];            // h and the ← escape sequence
const RIGHT_KEYS = ["l", "\u001b[C"];           // l and the → escape sequence

export const keysMoveSelection = always(        // in every state …
  now(() => {
    const current = dayInfo.current?.day;       // … take the selected day now
    if (current === undefined) return true;     //   (nothing rendered yet: skip)
    return next(() => {                         // … and in the very next state
      const following = dayInfo.current?.day;   //   the day shown then
      const key = lastKey.current;              //   the key that caused it
      if (following === undefined || key === null) return true;
      if (LEFT_KEYS.includes(key)) return following === Math.max(current - 1, 0);
      if (RIGHT_KEYS.includes(key)) return following === Math.min(current + 1, DAYS - 1);
      return following === current;             //   any other key: no change
    });
  }),
);
```

- `dayInfo` and `lastKey` are **extractors**: `dayInfo` parses
  `Day: 07/30` off the screen, and `lastKey` reads the keystroke from
  `state.lastAction`.
- `now(() => …)` runs in one state and captures `current`. The `next`
  inside it is then checked against the **following** state, so one
  property compares two states.
- Every action is exactly one key (see the TUI action generators), so "the
  key that caused this state" is well defined.

### 3. Break it yourself

Make one of these one-line changes, run the suite, and watch which property
catches it. Each row was checked with `make test-tui` / `make test-web
TIME=20s`. Undo with `git checkout -- tui web`.

| Change | File | Caught by |
| --- | --- | --- |
| `case "left", "h":` → `case "left":` (h does nothing) | `tui/main.go` | `keysMoveSelection` |
| Remove the `if m.selected > 0` clamp around `m.selected--` | `tui/main.go` | `exitSuccess` (default): the app panics at day -1 on the first `h` |
| `m.selected--` → `m.selected -= 2` | `tui/main.go` | `exitSuccess` (default): from day 1 it jumps to -1 and panics |
| Email check → `return "";` | `web/app.js` | `successRequiresValidData`, `invalidSubmitShowsErrors` |
| Delete the toast `setTimeout(…)` | `web/app.js` | `toastEventuallyHides` |
| `if (valid) showSuccess();` → `if (valid) {}` | `web/app.js` | `validSubmitShowsSuccess` |

Notice the two crash rows: you didn't write a "doesn't crash" property, but
the defaults re-exported at the top of each spec (`exitSuccess`,
`noUncaughtExceptions`, …) catch whole kinds of bugs for free.

---

## Writing good properties

### Check both directions

`successRequiresValidData` says *success ⇒ valid data*. A form that
**never** shows success passes it, and so does a TUI that ignores every
key when checked only by `dayMovesOneStepAtATime` ("moves at most one
step"). Each "nothing wrong is shown" property needs a partner that says
"the right thing is shown":

| Safety ("nothing bad") | Liveness ("something good") |
| --- | --- |
| `successRequiresValidData` | `validSubmitShowsSuccess` |
| `errorsOnlyShownForInvalidFields` | `invalidSubmitShowsErrors` |
| `dayMovesOneStepAtATime` | `keysMoveSelection` |

The "Break it yourself" row `if (valid) {}` is caught **only** by the
liveness side.

### Properties only see observed states

Bombadil checks properties against the states it **captures**, roughly one
after each action. Something that happens and un-happens between two
captures is invisible to it. This bit the toast guarantee: the toast's 5 s
timer hid it, a `submitWith("valid")` a few milliseconds later showed it
again, no state was captured in between, and the spec saw one toast
visible for more than 8 s, a violation the app never committed.

The fix was to make the event observable rather than to loosen the
property: the app numbers each appearance in `data-showing`, and
`toastEventuallyHides` counts *hidden **or** a newer appearance* as "this
showing ended".

### Keep the spec independent of the app

`bombadil/web.spec.ts` restates the email rule (`EMAIL_RE`) instead of
importing it from `web/app.js`. If the spec reused the app's code, a bug
in that code would be a bug in the test too, and the test would agree with
it.

---

## Running the tests

| Goal | Command |
| --- | --- |
| Both suites, combined report | `make test` |
| Web app only | `make test-web` |
| TUI only | `make test-tui` |
| Install deps and build the TUI, no tests | `make build` |
| Longer exploration (e.g. 2 minutes per app) | `make test TIME=2m` |
| Watch Chrome while testing | `make test-web HEADLESS=0` |

The orchestrator (`scripts/run-tests.sh`) builds the TUI, starts the static
server on `:8080` for the web run (reused if already up, shut down on exit),
runs each suite with its own trace + log, and hands the results to
`scripts/report.mjs`, which prints the combined table above. Exit codes
follow Bombadil: `0` green, `2` violations, `1` error — so `make test`
fails the build when any suite is red.

Every run leaves a binary trace and a log in `traces/`. The next section
explains how to read them.

---

## How Bombadil traces work

### What a trace records

`scripts/run-tests.sh` passes `--output-path traces/<suite>-<stamp>.bin`, so
every run writes one trace file. It holds **every state** Bombadil captured,
and each state records:

- its index (`#0`, `#1`, …) and time since the start;
- the **action** that produced it (`TypeText`, `Click`, `Custom submitWith`, …);
- the page URL (browser traces);
- the properties **violated** in that state;
- a snapshot of **every `extract` value** in the spec, under its variable name
  (`dayInfo`, `lastKey`, `toastInfo`, `fieldInfo`, …), which is exactly what
  the properties saw;
- the terminal **screen** (TUI) or a **screenshot** (browser).

The matching `traces/logs/<suite>-<stamp>.log` holds the actions and the
human-readable violation messages.

### Reading a trace

```sh
B=./node_modules/.bin/bombadil

$B trace traces/tui-<stamp>.bin                    # one line per state: action + violations
$B trace traces/tui-<stamp>.bin --state 40..50     # a range (also 40.. or ..50)
$B trace traces/tui-<stamp>.bin --screen           # + the terminal screen of each state
$B trace traces/tui-<stamp>.bin --color            # + colors and styles
$B trace traces/web-<stamp>.bin --screenshots shots/   # browser: one PNG per state
$B browser inspect traces/web-<stamp>.bin          # browser: open the interactive viewer
```

Real output from a `failing-demo` TUI run:

```text
terminal trace
#0        +0.000s  (initial state)  (5.1 KB payload)
       violated: "dottedLineAtSelectedColumn", "priceAlwaysMatchesSelection"
#1        +0.081s  TypeText {"text":"l"}  (5.1 KB payload)
       violated: "dottedLineAtSelectedColumn", "dayMovesOneStepAtATime", "keysMoveSelection", "priceAlwaysMatchesSelection"
#2        +0.164s  TypeText {"text":"h"}  (5.1 KB payload)
       violated: "dottedLineAtSelectedColumn", "priceAlwaysMatchesSelection"
```

and from a browser run, where custom actions show up by name:

```text
#3        +0.073s  Custom {"name":"submitWith","arguments":["invalidEmail"]}  (18.9 KB payload)
       url: "http://localhost:8080/"
       violated: "successRequiresValidData", "invalidSubmitShowsErrors", "toastIsTopRight"
```

For scripting, `--json` prints one object per state. The per-state data
lives under `metadata` (`action`, `violations`, `snapshots`). To find the
first violating state:

```sh
$B trace traces/tui-<stamp>.bin --json | python3 -c '
import sys, json
for line in sys.stdin:
    s = json.loads(line)
    if s["metadata"]["violations"]:
        print(s["index"], [v["name"] for v in s["metadata"]["violations"]]); break'
```

### A real failure, step by step

On `failing-demo` the TUI's right key advances two days. State `#1` above
is the first `l` press. Its screen (`--screen --state 1..2`):

```text
#1        +0.081s  TypeText {"text":"l"}  (5.1 KB payload)
       | BMBDL - Mock Stock Performance
       | Day: 02/30  Close: $141.85
```

and the log explains the `keysMoveSelection` violation, showing the
extractor values it saw:

```text
keysMoveSelection was violated:

as of 00:01.101, it should always be the case that:
  () => { const current = dayInfo.current?.day; … return next(() => { … }) }

however at 00:01.182:

dayInfo =
  day: 2.0
  total: 30.0
lastKey = l
```

Read it as: *in the state before, the day was 0; then `l` was pressed; in
the next state the day is 2, but `l` must give `min(0 + 1, 29) = 1`*. The
trace gave you the input (one `l` from day 0), the expected value, the
actual value and the screen, without anyone writing that test case.

### Replaying and shrinking

A trace stores the actions, so a run can be **replayed** against the
(fixed or still broken) app:

```sh
# TUI
$B terminal test --specification bombadil/tui.spec.ts --quiescence-timeout-ms 50 \
   --reproduce traces/tui-<stamp>.bin -- ./tui/bin/bmbdl

# web (needs the server: `make serve` in another shell)
$B browser test --headless --reproduce traces/web-<stamp>.bin \
   http://localhost:8080/ bombadil/web.spec.ts
```

Replay is **best-effort**: it fails if the app diverges from the recording
(timing-sensitive states like the toast can differ). In the browser,
`--reproduce` cannot be combined with `--time-limit`.

A random run can take hundreds of actions to hit a bug. **Shrinking**
(experimental) searches for a shorter action sequence that still
violates the property:

```sh
$B terminal shrink --trace traces/tui-<stamp>.bin --property keysMoveSelection \
   --specification bombadil/tui.spec.ts --quiescence-timeout-ms 50 -- ./tui/bin/bmbdl
```

On `failing-demo` this takes a 30-second random run (hundreds of
keystrokes) down to the smallest possible story, a single `l`:

```text
  Reproduced: 3/3 (original: 3/3)
Shrunk trace written to: /tmp/…/shrunk.bin

$ bombadil trace /tmp/…/shrunk.bin
#0        +0.000s  (initial state)  (5.1 KB payload)
       violated: "priceAlwaysMatchesSelection", "dottedLineAtSelectedColumn"
#1        +0.067s  TypeText {"text":"l"}  (5.1 KB payload)
       violated: "dayMovesOneStepAtATime", "priceAlwaysMatchesSelection", "dottedLineAtSelectedColumn", "keysMoveSelection"
```

(`bombadil browser shrink --trace <trace> --property <name> <url> <spec>`
works the same for the web app.)

### Things that differ from what you'd expect

- The trace prints a keystroke as `TypeText {"text":"l"}`, but inside a spec
  `state.lastAction.TypeText` is just the string `"l"`. The `lastKey`
  snapshot in the trace shows that runtime value.
- At runtime (Bombadil 0.8) a custom action's arguments are in
  `lastAction.Custom.arguments`, while the TypeScript types call them
  `args`. `bombadil/web.spec.ts` reads both; see `lastSubmitMode`.
- Traces are big (a few hundred MB after a day of runs). They are
  gitignored; `make clean` removes them along with the logs and the TUI
  binary.

---

## The failing branch

The branch **`failing-demo`** keeps both apps compiling and runnable but
breaks their invariants on purpose:

- **web:** the email pattern check is dropped (any non-empty email passes)
  → the success panel can appear with an invalid email
  → `successRequiresValidData` and `invalidSubmitShowsErrors` fail.
  The toast moves to the bottom-left and stops auto-dismissing
  → `toastIsTopRight` and `toastEventuallyHides` fail.
- **tui:** the right-arrow key advances **two** days →
  `dayMovesOneStepAtATime` and `keysMoveSelection` fail; the dotted line is
  drawn one column to the right of the selected day →
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
                     - invalidSubmitShowsErrors (x...)
                     - successRequiresValidData (x...)
                     - toastEventuallyHides (x...)
                     - toastIsTopRight (x...)
 tui (terminal)    FAIL                ...        30s  traces/tui-....bin
                   violated properties:
                     - dayMovesOneStepAtATime (x...)
                     - dottedLineAtSelectedColumn (x...)
                     - keysMoveSelection (x...)
                     - priceAlwaysMatchesSelection (x...)
 OVERALL: FAIL (0/2 suites green)
```

### Fixing it: property-based vs. example-based testing

On `failing-demo`, run one suite and follow the report (for the TUI,
`make test-tui`). Then open the trace as described in
[How Bombadil traces work](#how-bombadil-traces-work): each violating state
shows the property name, the screen *as the property saw it*, and the
actions that led there, which you can replay with `--reproduce`.

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

## Work done with Claude Opus 5.5

The first version of `main` and `failing-demo` was built on 2026-11-21
(commits `4895f55`…`10a6d4c`). Claude Opus 5.5 then did two things.

### 1. Review and extend `main`

Three commits on `main` (and rebased onto `failing-demo`):

- **`8a51b23` Check both directions in properties.** New properties fail
  when an app does *nothing*: a valid submit must show the success panel and
  toast, an invalid submit must show errors, and `h`/`l`/arrow keys must move
  the TUI selection by exactly one day. The dotted-line property now checks
  that the line reaches the highlighted point. Toast appearances are numbered
  (`data-showing`) so a hide-and-reshow is not mistaken for one long showing.
  The TUI draws each day at its exact price, `make test` keeps exit code 2
  once any suite has violations, and README drift was fixed.
- **`cbd1f6b` Teach property-based testing and traces.** Added the worked
  examples, "Writing good properties", the operator guide and the
  [traces](#how-bombadil-traces-work) section, all using real output.
- **`f5ffac7` Show a real shrink result** in the trace section.

### 2. Rebuild from scratch: `opus-5.5` and `opus-5.5-failing`

To compare approaches, Opus 5.5 built the whole project again from the same
[`project_setup.prompt.md`](project_setup.prompt.md). The result is the branch **`opus-5.5`**, with its own README. It
**shares no history with `main`** (`git merge-base main opus-5.5` finds
nothing), so treat it as a separate implementation, not a newer version of
`main`. Never merge the two.

**`opus-5.5-failing`** branches off `opus-5.5` and adds four bugs, one per
commit (`git log opus-5.5..opus-5.5-failing`).

#### How `opus-5.5` differs from `main`

| | `main` | `opus-5.5` |
| --- | --- | --- |
| Specs | `bombadil/web.spec.ts`, `bombadil/tui.spec.ts` | `specs/web.spec.ts`, `specs/tui.spec.ts` |
| Orchestration | `scripts/run-tests.sh` runs everything | `scripts/run-suite.sh` runs one suite; Make calls it per suite |
| Web server | `scripts/serve.mjs`, port 8080 | `web/server.mjs`, port 5173 |
| TUI | one `main.go`, stock `BMBDL` from `stock.json` | split into `main.go`, `model.go`, `chart.go`, `data.go`; stock `ACME` from embedded `prices.json`; adds `Home`/`g` and `End`/`G` keys |
| Make settings | `TIME`, `PORT`, `HEADLESS`, `QUIESCENCE_MS` | `TIME_LIMIT`, `WEB_PORT` |
| Extra targets | `build`, `serve`, `clean` | `build`, `run-web`, `run-tui`, `report`, `inspect-web`, `trace-tui`, `help` |
| Output | `traces/` (binary trace + log) | `results/` (log, trace and exit code per suite) |
| Report | violated properties and counts per suite | built from trace JSON: first violating state, the action before it, and Bombadil's explanation |
| Properties | separate rules for each key, toast and field | adds `navigationStateMachine` (one rule for every key); properties read small derived cells, so a violation names the values involved (e.g. `selectedDay = 31.0`); `selectionInRange` alone reports out-of-range days, so one bug fails one rule |
| Web app | toast countdown starts on appearance | toasts capped at three, one line each. Bombadil found this bug during the build: six quick submits pushed toasts below the top half of the screen |
| Prerequisites | Node 20+, Go 1.25+ | Node 18+, Go 1.22+ |

#### How `opus-5.5-failing` differs from `failing-demo`

`failing-demo` breaks things loudly: six changes in two commits (toast moved
to the bottom-left, auto-dismiss removed, email check dropped, right arrow
skips two days, and so on), so many properties go red at once.

`opus-5.5-failing` uses four small, realistic bugs, the kind that pass a
quick manual check:

| App | Bug | Property that catches it |
| --- | --- | --- |
| web | last name is only checked for being non-empty (`Smith3` passes) | `errorShownIffInvalid` |
| web | a new toast cancels the previous toast's dismiss timer | `toastDisappears` |
| tui | right-edge check uses the day count, not the last index, so "Day 31" can be selected | `selectionInRange` (and `navigationStateMachine`) |
| tui | the dotted line stops one row below the marker | `dottedLineTouchesPoint` |

Each suite stops at the first violation, so a run shows one failing property
per suite. Fix that bug and the next one appears.

#### Running the Opus 5.5 branches

```sh
git checkout opus-5.5
make deps          # npm ci (Bombadil 0.8.0) + go mod download
make test          # both suites, then the combined report (green)
make test-web      # or one suite; make help lists every target
make test TIME_LIMIT=2m WEB_PORT=5174

git checkout opus-5.5-failing
make test          # red: one violated property per suite
make report        # print the last report again
make trace-tui     # every screen of the last TUI trace
make inspect-web   # open the last web trace in Bombadil Inspect

git checkout main  # back to this implementation
```

The `opus-5.5` README has the full property tables and a walkthrough of
fixing each bug.

---

## Version control

- `main` (green) and `failing-demo` (red) hold the original implementation;
  `opus-5.5` (green) and `opus-5.5-failing` (red) hold the separate Opus 5.5
  rebuild. Each pair has incremental commits.
- The configured remote is `https://github.com/hrmeetsingh/property_based_bombadil`.
  `failing-demo` and `opus-5.5-failing` are demonstration branches: never
  merge them, and never merge `opus-5.5` into `main` (unrelated histories).
