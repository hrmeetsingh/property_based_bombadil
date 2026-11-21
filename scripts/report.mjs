// Combined terminal report for the Bombadil test runs.
//
//   node scripts/report.mjs traces/logs/results-<stamp>.tsv
//
// Reads the results file written by run-tests.sh (one row per suite:
// name, exit code, duration seconds, trace path, log path), extracts
// violated property names from each trace (falling back to the log),
// prints one combined table, and exits non-zero if any suite failed.
//
// Exit codes mirror bombadil: 0 = all green, 2 = violations, 1 = error.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath of "../" keeps the trailing separator, so this is already
// the project root - do not run dirname() on it, that would strip the
// root directory name itself.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BOMBADIL = join(ROOT, "node_modules/.bin/bombadil");

const SUITE_LABELS = {
  web: "web (browser)",
  tui: "tui (terminal)",
};

const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error("usage: node scripts/report.mjs <results.tsv>");
  process.exit(1);
}

const rows = readFileSync(resultsPath, "utf-8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => {
    const [suite, code, duration, trace, log] = line.split("\t");
    return {
      suite,
      code: Number(code),
      duration: Number(duration),
      trace,
      log,
      label: SUITE_LABELS[suite] ?? suite,
    };
  });

if (rows.length === 0) {
  console.error("no results recorded");
  process.exit(1);
}

// --- violation extraction ---------------------------------------------------

// Walk an arbitrary JSON structure collecting violated property names.
// The trace format puts them in `metadata.violations[].name`; the fallbacks
// keep the report readable even if that shape ever changes.
function collectViolationNames(value, out) {
  if (Array.isArray(value)) {
    for (const item of value) collectViolationNames(item, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "violations" && Array.isArray(item)) {
        for (const entry of item) {
          if (entry !== null && typeof entry === "object" && typeof entry.name === "string") {
            out.push(entry.name);
          } else {
            gatherStrings(entry, out);
          }
        }
        continue;
      }
      if (/propert/i.test(key)) gatherStrings(item, out);
      collectViolationNames(item, out);
    }
  }
}

function gatherStrings(value, out) {
  if (typeof value === "string") {
    if (value.trim() !== "") out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) gatherStrings(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) gatherStrings(item, out);
  }
}

function violationsFromTrace(tracePath) {
  const abs = resolve(tracePath);
  if (!existsSync(abs)) return {};
  let jsonl;
  try {
    jsonl = execFileSync(BOMBADIL, ["trace", abs, "--json"], {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return {};
  }
  const names = [];
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    try {
      collectViolationNames(JSON.parse(line), names);
    } catch {
      // ignore unparsable lines
    }
  }
  const counts = {};
  for (const name of names) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

// Fallback: grep the run log for anything that smells like a violation.
function violationsFromLog(logPath) {
  if (!existsSync(logPath)) return {};
  const text = readFileSync(logPath, "utf-8");
  const counts = {};
  for (const line of text.split("\n")) {
    if (/violation/i.test(line)) {
      const key = line.trim().slice(0, 120);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

// --- report -----------------------------------------------------------------

const pad = (text, width) => String(text).padEnd(width);
const padStart = (text, width) => String(text).padStart(width);

const WIDTH = 78;
const line = (ch = "-") => ch.repeat(WIDTH);

console.log(line("="));
console.log(" Bombadil property-based test report".padEnd(WIDTH));
console.log(` ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`.padEnd(WIDTH));
console.log(line("="));
console.log(` ${pad("Suite", 18)}${pad("Result", 10)}${padStart("Violations", 12)}${padStart("Duration", 11)}  Trace`);
console.log(` ${line()}`);

let totalFailed = 0;
let worstCode = 0;

for (const row of rows) {
  let violations = {};
  if (row.code !== 0) {
    violations = violationsFromTrace(row.trace);
    if (Object.keys(violations).length === 0) violations = violationsFromLog(row.log);
  }
  const violationCount = Object.values(violations).reduce((a, b) => a + b, 0);
  const hasViolations = violationCount > 0;

  // Property violations are a FAIL even when the driver's exit code says
  // otherwise (the terminal driver exits 1 on violations, the browser
  // driver exits 2). Only runs without violations and non-zero exit are
  // genuine errors.
  const status = row.code === 0 ? "PASS" : hasViolations ? "FAIL" : "ERROR";
  if (row.code !== 0) {
    totalFailed += 1;
    if (hasViolations && worstCode < 2) worstCode = 2;
    if (!hasViolations) worstCode = 1;
  }

  console.log(
    ` ${pad(row.label, 18)}${pad(status, 10)}${padStart(row.code === 0 ? 0 : violationCount, 12)}${padStart(row.duration + "s", 11)}  ${row.trace}`,
  );

  const names = Object.keys(violations);
  if (names.length > 0) {
    console.log(` ${pad("", 18)}violated properties:`);
    for (const name of names.sort()) {
      console.log(` ${pad("", 20)}- ${name} (x${violations[name]})`);
    }
  }
  if (status === "ERROR") {
    console.log(` ${pad("", 18)}see log: ${row.log}`);
  }
}

console.log(line("="));
const green = rows.length - totalFailed;
if (totalFailed === 0) {
  console.log(` OVERALL: PASS (${green}/${rows.length} suites green)`);
} else {
  console.log(` OVERALL: FAIL (${green}/${rows.length} suites green)`);
  console.log(" Traces can be replayed:  ./node_modules/.bin/bombadil trace <trace> --screen");
}
console.log(line("="));

process.exit(worstCode === 0 ? 0 : worstCode);
