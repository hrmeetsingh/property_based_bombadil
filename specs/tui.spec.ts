// Bombadil specification for the stock chart TUI (tui/).
//
// Bombadil starts the TUI in a virtual terminal, presses random keys
// (the action generators below), and after every key press checks that
// each exported property still holds. A property is a rule that must be
// true for *every* screen, not one expected screen for one scripted input.
//
// Run it with `make test-tui`.

import { always, next, now } from "@antithesishq/bombadil";
import { actions, extract, weighted } from "@antithesishq/bombadil/terminal";
// The same data file the Go app embeds: the spec uses it as the oracle for
// what the chart must show.
import stock from "../tui/prices.json";

// Default terminal properties: the app never exits with an error code and
// never prints bytes the terminal can't render.
export { exitSuccess, noReplacementChars } from "@antithesishq/bombadil/terminal/defaults";

// ---------------------------------------------------------------------------
// Screen layout. These mirror the constants at the top of tui/chart.go.
// ---------------------------------------------------------------------------
const CHART_TOP = 2;
const CHART_HEIGHT = 16;
const AXIS_ROW = CHART_TOP + CHART_HEIGHT;
const STATUS_ROW = AXIS_ROW + 3;
const FIRST_DAY_COL = 11;
const DAY_STEP = 2;

const POINT = "•";
const MARKER = "●";
const DOTTED = "┊";

const days = stock.days;
const DAY_COUNT = days.length;
const prices = days.map((d) => d.price);
const MIN = Math.min(...prices);
const MAX = Math.max(...prices);

/** Screen column of a 1-based day. */
const dayCol = (day: number) => FIRST_DAY_COL + (day - 1) * DAY_STEP;

/** Plot row where a price must be drawn: highest price on top. */
const priceRow = (price: number) =>
  CHART_TOP + Math.round(((MAX - price) / (MAX - MIN)) * (CHART_HEIGHT - 1));

// ---------------------------------------------------------------------------
// Extractors: read the terminal after every action.
// ---------------------------------------------------------------------------

/** Every row of the terminal as plain text. */
const screen = extract((state) => {
  const lines: string[] = [];
  for (let row = 0; row < state.grid.size.rows; row++) {
    lines.push(state.grid.rowText(row));
  }
  return lines;
});

/** The keys sent by the action that led to this state, if any. */
const lastKeys = extract((state) => {
  const action = state.lastAction as unknown;
  if (action && typeof action === "object" && "TypeText" in action) {
    const typed = (action as { TypeText: unknown }).TypeText;
    if (typeof typed === "string") return typed;
    if (typed && typeof typed === "object" && "text" in typed) {
      return String((typed as { text: unknown }).text);
    }
  }
  return null;
});

/** Character at (row, column); columns count Unicode code points. */
function cellAt(lines: string[], row: number, col: number): string {
  return Array.from(lines[row] ?? "")[col] ?? " ";
}

/** Has the app drawn its first frame yet? Before that, nothing is checked. */
function ready(lines: string[]): boolean {
  return (lines[0] ?? "").includes(stock.symbol);
}

type Status = { day: number; date: string; price: string } | null;

/** Parse "Selected: Day 07 · 2026-10-07 · Price: $119.64 · ..." */
function status(lines: string[]): Status {
  const m = (lines[STATUS_ROW] ?? "").match(
    /Selected: Day (\d+) · (\S+) · Price: \$(\d+\.\d\d)/,
  );
  return m ? { day: Number(m[1]), date: m[2], price: m[3] } : null;
}

/** All cells in the plot area that hold the given glyph. */
function findGlyph(lines: string[], glyph: string): { row: number; col: number }[] {
  const found: { row: number; col: number }[] = [];
  for (let row = CHART_TOP; row < AXIS_ROW; row++) {
    Array.from(lines[row] ?? "").forEach((ch, col) => {
      if (ch === glyph) found.push({ row, col });
    });
  }
  return found;
}

// Small cells derived from the screen. Properties read these rather than
// the whole screen, so a violation report shows just the values involved.
const drawn = screen.map(ready);
const statusLine = screen.map(status);
const selectedDay = statusLine.map((s) => s?.day ?? null);
/** For each day, the plot rows holding a point (should be exactly one). */
const plottedRows = screen.map((lines) =>
  days.map((d) => {
    const rows: number[] = [];
    for (let row = CHART_TOP; row < AXIS_ROW; row++) {
      const ch = cellAt(lines, row, dayCol(d.day));
      if (ch === POINT || ch === MARKER) rows.push(row);
    }
    return rows;
  }),
);
const markers = screen.map((lines) => findGlyph(lines, MARKER));
const dottedCells = screen.map((lines) => findGlyph(lines, DOTTED));

const inRange = (day: number | null): day is number =>
  day !== null && day >= 1 && day <= DAY_COUNT;

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

/** The selected day is always a real day of the data set (1..30). */
export const selectionInRange = always(
  () => !drawn.current || inRange(selectedDay.current),
);

/** The status line shows the selected day's real date and price. */
export const statusMatchesData = always(() => {
  if (!drawn.current) return true;
  const s = statusLine.current;
  if (s === null) return false; // the status line must always be there
  const expected = days[s.day - 1];
  if (expected === undefined) return true; // reported by selectionInRange
  return s.date === expected.date && s.price === expected.price.toFixed(2);
});

/** Every day's price is plotted on the row its price maps to, and only there. */
export const lineMatchesPrices = always(() => {
  if (!drawn.current) return true;
  return days.every((d, i) => {
    const rows = plottedRows.current[i];
    return rows.length === 1 && rows[0] === priceRow(d.price);
  });
});

/** Exactly one marker, sitting on the selected day's price. */
export const markerOnSelectedDay = always(() => {
  if (!drawn.current) return true;
  const day = selectedDay.current;
  if (!inRange(day)) return true; // reported by selectionInRange
  const m = markers.current;
  return m.length === 1 && m[0].col === dayCol(day) && m[0].row === priceRow(days[day - 1].price);
});

/**
 * The dotted line starts at the x-axis and touches the marker: every cell
 * between them in the selected column is dotted, and there are no dotted
 * cells anywhere else.
 */
export const dottedLineTouchesPoint = always(() => {
  if (!drawn.current) return true;
  const day = selectedDay.current;
  if (!inRange(day)) return true; // reported by selectionInRange
  const col = dayCol(day);
  const top = priceRow(days[day - 1].price) + 1; // just below the marker
  const expected = AXIS_ROW - top; // cells from there down to the axis
  const dotted = dottedCells.current;
  return (
    dotted.length === expected &&
    dotted.every((c) => c.col === col && c.row >= top && c.row < AXIS_ROW)
  );
});

// Key sequences the app understands, as the terminal sends them.
const RIGHT = ["l", "\x1b[C"];
const LEFT = ["h", "\x1b[D"];
const FIRST = ["g", "\x1b[H"];
const LAST = ["G", "\x1b[F"];

/** Where the selection must be after pressing `keys` on day `day`. */
function expectedDay(day: number, keys: string | null): number {
  if (keys === null) return day;
  if (RIGHT.includes(keys)) return Math.min(DAY_COUNT, day + 1);
  if (LEFT.includes(keys)) return Math.max(1, day - 1);
  if (FIRST.includes(keys)) return 1;
  if (LAST.includes(keys)) return DAY_COUNT;
  return day; // any other key leaves the selection alone
}

/**
 * Navigation as a state machine: from each screen to the next, the
 * selection moves exactly as the pressed key says (stopping at the edges),
 * and other keys don't move it.
 */
export const navigationStateMachine = always(
  now(() => {
    if (!drawn.current) return true;
    const before = selectedDay.current;
    if (before === null) return true; // reported by selectionInRange
    return next(() => {
      if (!drawn.current) return true;
      return selectedDay.current === expectedDay(before, lastKeys.current);
    });
  }),
);

// ---------------------------------------------------------------------------
// Actions: which keys Bombadil may press, with weights.
// ---------------------------------------------------------------------------

const key = (regexp: string) => ({ TypeText: { Regexp: regexp } });

export const keyPresses = weighted([
  [5, actions(() => [key("l"), key("\\x1b\\[C")])], // next day
  [5, actions(() => [key("h"), key("\\x1b\\[D")])], // previous day
  [2, actions(() => [key("g"), key("G"), key("\\x1b\\[H"), key("\\x1b\\[F")])], // first / last
  // Keys the app should ignore. Never q or Ctrl+C: quitting ends the run.
  [1, actions(() => [key("[a-fi-kmnoprs-z0-9 ]")])],
]);
