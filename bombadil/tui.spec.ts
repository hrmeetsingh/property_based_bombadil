// Bombadil specification for the BMBDL stock TUI (terminal driver).
//
// The properties below are the functional invariants of the TUI:
//
//   1. titleAlwaysVisible         - whenever the app has rendered, row 0
//                                   shows the ticker title.
//   2. selectedDayInRange         - the selected day index is always inside
//                                   the dataset and the total always matches.
//   3. dayMovesOneStepAtATime     - state machine: a state transition can
//                                   only keep the selection, move it +1 or
//                                   move it -1 (no jumps).
//   4. priceAlwaysMatchesSelection- the close price shown always equals the
//                                   dataset price of the selected day.
//   5. axisMarkerMatchesSelection - the bracketed x-axis label always marks
//                                   the same day as the status line.
//   6. dottedLineAtSelectedColumn - the vertical dotted line always sits at
//                                   the x-axis column of the selected day
//                                   and runs unbroken from the x-axis up to
//                                   the highlighted point "*".
//   7. keysMoveSelection          - h/left selects the previous day, l/right
//                                   the next one (clamped at the ends), and
//                                   any other key leaves the selection alone.
//
// Properties 2-6 say "what is shown is consistent"; 7 says "the keys do
// what they promise". Without 7 an app that ignored every key would pass.
//
// Plus the terminal defaults re-exported below: exitSuccess (the app never
// crashes with a non-zero exit code) and noReplacementChars (no malformed
// UTF-8 is ever emitted).
//
// Actions: single keystrokes only, so every captured state transition is
// caused by exactly one key: h/l and the arrow keys move the selection,
// everything else is random junk the app must ignore without crashing.
// "q" is deliberately not generated - it would end the run immediately;
// it is part of the manual flow (see README).

import { always, now, next, actions, weighted } from "@antithesishq/bombadil";
import { extract, type ActionTemplate } from "@antithesishq/bombadil/terminal";
import stock from "../tui/stock.json";

// Terminal defaults: expect a clean exit and well-formed UTF-8.
export { exitSuccess, noReplacementChars } from "@antithesishq/bombadil/terminal/defaults";

const DAYS = stock.length;

// --- State extraction -----------------------------------------------------

// Every row of the terminal grid, indexed by row number.
const screenRows = extract((state) => {
  const rows: string[] = [];
  for (let i = 0; i < state.grid.size.rows; i++) {
    rows.push(state.grid.rowText(i));
  }
  return rows;
});

const gridSize = extract((state) => ({
  rows: state.grid.size.rows,
  cols: state.grid.size.columns,
}));

// The first regex match on any row, or null when no row matches.
function firstMatch(rows: string[], re: RegExp): RegExpMatchArray | null {
  for (const row of rows) {
    const m = row.match(re);
    if (m) return m;
  }
  return null;
}

// "Day: 07/30" from the status line (row 1 in a rendered frame).
const dayInfo = screenRows.map((rows) => {
  const m = firstMatch(rows, /Day:\s*(\d+)\/(\d+)/);
  return m ? { day: Number(m[1]), total: Number(m[2]) } : null;
});

// "Close: $149.40" from the status line.
const closeInfo = screenRows.map((rows) => {
  const m = firstMatch(rows, /Close:\s*\$(\d+\.\d{2})/);
  return m ? Number(m[1]) : null;
});

// The keystroke that produced the current state, or null.
const lastKey = extract((state) => {
  const action = state.lastAction;
  if (action === null || !("TypeText" in action)) return null;
  return action.TypeText;
});

// The bracketed selected-day label on the last row (the x-axis).
const axisMarker = screenRows.map((rows) => {
  const last = rows[rows.length - 1] ?? "";
  const m = last.match(/\[(\d+)\]/);
  return m ? Number(m[1]) : null;
});

// The app has rendered a frame if its status line is parseable.
const rendered = dayInfo.map((info) => info !== null);

// Columns (>= row 2, so the status line's "Day:" colon is excluded) that
// contain the vertical dotted-line character.
const dottedColumns = screenRows.map((rows) => {
  const cols = new Set<number>();
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === ":") cols.add(c);
    }
  }
  return Array.from(cols).sort((a, b) => a - b);
});

// --- Properties ------------------------------------------------------------

// 1. Once the app has rendered a frame, the title row is present.
export const titleAlwaysVisible = always(
  now(() => !rendered.current).or(now(() => (screenRows.current[0] ?? "").includes("BMBDL"))),
);

// 2. The selected day index is always inside the dataset, and the total
//    always equals the number of days in stock.json.
export const selectedDayInRange = always(() => {
  const info = dayInfo.current;
  if (info === null) return true; // before the first render
  return info.day >= 0 && info.day < DAYS && info.total === DAYS;
});

// 3. State machine: selection only ever stays, moves forward one day, or
//    moves back one day between two consecutive states.
export const dayMovesOneStepAtATime = always(
  now(() => {
    const current = dayInfo.current?.day;
    if (current === undefined) return true; // before the first render
    return next(() => {
      const following = dayInfo.current?.day;
      if (following === undefined) return true; // nothing to compare against
      return following === current || following === current - 1 || following === current + 1;
    });
  }),
);

// 4. The displayed close price always matches the dataset value for the
//    selected day (down to the cent).
export const priceAlwaysMatchesSelection = always(() => {
  const info = dayInfo.current;
  const close = closeInfo.current;
  if (info === null || close === null) return true;
  if (info.day < 0 || info.day >= DAYS) return true; // covered by property 2
  return Math.abs(close - stock[info.day]) < 0.005;
});

// 5. The bracketed x-axis label always marks the same day as the status line.
export const axisMarkerMatchesSelection = always(() => {
  const day = dayInfo.current?.day;
  const marker = axisMarker.current;
  if (day === undefined || marker === null) return true;
  return marker === day;
});

// 6. The vertical dotted line sits exactly at the x-axis column of the
//    selected day: column = round(day * (cols - 1) / (DAYS - 1)), and it
//    runs unbroken from the x-axis row up to the "*" point in that column.
export const dottedLineAtSelectedColumn = always(() => {
  const day = dayInfo.current?.day;
  const cols = dottedColumns.current;
  if (day === undefined) return true;
  if (cols.length === 0) return true; // degenerate terminal, no plot
  const expected = Math.round((day * (gridSize.current.cols - 1)) / (DAYS - 1));
  if (cols.length !== 1 || cols[0] !== expected) return false;

  const rows = screenRows.current;
  const axisRow = rows.length - 2;
  const pointRow = rows.findIndex((row, i) => i >= 2 && row[expected] === "*");
  if (pointRow === -1 || pointRow >= axisRow) return false;
  for (let r = pointRow + 1; r <= axisRow; r++) {
    if (rows[r][expected] !== ":") return false;
  }
  return true;
});

// 7. State machine over keystrokes: the key that produced the next state
//    decides where the selection must be.
const LEFT_KEYS = ["h", "\u001b[D"];
const RIGHT_KEYS = ["l", "\u001b[C"];

export const keysMoveSelection = always(
  now(() => {
    const current = dayInfo.current?.day;
    if (current === undefined) return true; // before the first render
    return next(() => {
      const following = dayInfo.current?.day;
      const key = lastKey.current;
      if (following === undefined || key === null) return true;
      if (LEFT_KEYS.includes(key)) return following === Math.max(current - 1, 0);
      if (RIGHT_KEYS.includes(key)) return following === Math.min(current + 1, DAYS - 1);
      return following === current;
    });
  }),
);

// --- Action generators -----------------------------------------------------

// Exactly one keystroke per action:
//   [hl]                 - h/l move the selection (single character)
//   ESC[D / ESC[C        - arrow keys move the selection (one escape sequence)
//   everything else      - printable junk the app must ignore (no control
//                          characters, so no accidental ctrl+c quit)
const moveLeftRight = { TypeText: { Regexp: "[hl]" } } as ActionTemplate;
const arrowKeys = { TypeText: { Regexp: "\u001b\\[[DC]" } } as ActionTemplate;
const junkKeys = { TypeText: { Regexp: "[^hlq\\x00-\\x1f\\x7f-\\u{ffff}]" } } as ActionTemplate;

export const tuiKeys = weighted<ActionTemplate>([
  [10, moveLeftRight],
  [4, arrowKeys],
  [6, junkKeys],
]);
