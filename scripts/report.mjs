#!/usr/bin/env node
// Combined terminal report for the Bombadil suites that were run.
//
// Usage: node scripts/report.mjs web tui
//
// For each suite it reads results/<suite>.exit, results/<suite>.log and the
// trace (through `bombadil trace --json`). Pass or fail comes from the
// violations recorded in the trace, not from the exit code alone: the
// terminal driver exits 1 (not 2) when it finds a violation.
// Exits 1 if any suite failed or errored.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const results = join(root, "results");
const bombadil = join(root, "node_modules", ".bin", "bombadil");
const specs = { web: "specs/web.spec.ts", tui: "specs/tui.spec.ts" };

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = paint("32");
const red = paint("31");
const yellow = paint("33");
const bold = paint("1");
const dim = paint("2");

/** Names of the properties a spec exports (its actions are left out). */
function propertyNames(specFile) {
  const source = readFileSync(join(root, specFile), "utf8");
  const names = [];
  for (const m of source.matchAll(/export const (\w+)\s*=\s*(always|eventually|now|not)\(/g)) {
    names.push(m[1]);
  }
  for (const m of source.matchAll(/export\s*\{([^}]*)\}\s*from\s*"[^"]*defaults[^"]*"/g)) {
    names.push(...m[1].split(",").map((s) => s.trim()).filter(Boolean));
  }
  return names;
}

/** States of a trace, as printed by `bombadil trace --json`. */
function readTrace(file) {
  if (!existsSync(file)) return null;
  try {
    const out = execFileSync(bombadil, ["trace", file, "--json"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
    return out.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return null;
  }
}

function describeAction(action) {
  if (!action) return null;
  if (typeof action === "string") return action;
  const [kind, body] = Object.entries(action)[0];
  if (kind === "TypeText") return `typing ${JSON.stringify(body.text ?? body)}`;
  if (kind === "Custom") return `${body.name}(${(body.arguments ?? body.args ?? []).map((a) => JSON.stringify(a)).join(", ")})`;
  if (kind === "Click") {
    const fp = body.fingerprint ?? {};
    const what = fp.id ? `#${fp.id}` : fp.text_content ? `"${fp.text_content}"` : `<${fp.tag ?? "?"}>`;
    return `click on ${what}`;
  }
  return kind;
}

/** Bombadil's explanation of a violation, from the "however ..." line on. */
function violationMessage(log, name) {
  const start = log.indexOf(`${name} was violated:`);
  if (start < 0) return null;
  const rest = log.slice(start).split("\n").slice(1);
  const out = [];
  let seen = false;
  for (const line of rest) {
    if (/^(Test finished|Exited|Inspect the test|terminal test failed)/.test(line)) break;
    if (/\bwas violated:$/.test(line)) break;
    const at = line.indexOf("however");
    if (!seen && at >= 0) {
      seen = true;
      out.push(line.slice(at).trim());
    } else if (seen) {
      out.push(line.trim());
    }
  }
  const text = out.filter(Boolean).join(" ").replace(/\s+/g, " ");
  return text.length > 300 ? `${text.slice(0, 297)}...` : text || null;
}

function summarise(suite) {
  const exitFile = join(results, `${suite}.exit`);
  if (!existsSync(exitFile)) return { suite, status: "NOT RUN" };
  const exitCode = Number(readFileSync(exitFile, "utf8").trim());
  const logFile = join(results, `${suite}.log`);
  const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  const traceFile = join(results, `${suite}.trace`);
  const states = readTrace(traceFile) ?? [];

  const firstSeen = new Map(); // property -> first state that violated it
  for (const state of states) {
    for (const v of state.metadata?.violations ?? []) {
      if (!firstSeen.has(v.name)) firstSeen.set(v.name, state);
    }
  }
  const t0 = states[0]?.metadata?.timestamp ?? 0;
  const tEnd = states.at(-1)?.metadata?.timestamp ?? t0;
  const status = firstSeen.size > 0 ? "FAIL" : exitCode === 0 && states.length > 0 ? "PASS" : "ERROR";
  const actions = states.filter((s) => s.metadata?.action).length;

  return {
    suite,
    status,
    exitCode,
    states: states.length,
    actions,
    seconds: (tEnd - t0) / 1e6,
    properties: propertyNames(specs[suite]),
    violations: [...firstSeen].map(([name, state]) => ({
      name,
      index: state.index,
      at: ((state.metadata.timestamp - t0) / 1e6).toFixed(3),
      after: describeAction(state.metadata.action),
      message: violationMessage(log, name),
    })),
    logTail: log.trim().split("\n").slice(-5).join("\n"),
  };
}

const suites = process.argv.slice(2);
if (suites.length === 0) {
  console.error("usage: node scripts/report.mjs web [tui]");
  process.exit(1);
}

const badge = (status) =>
  status === "PASS" ? green(bold("PASS")) : status === "FAIL" ? red(bold("FAIL")) : yellow(bold(status));

const line = "─".repeat(72);
console.log();
console.log(bold("Bombadil property-based test report"));
console.log(line);
console.log(bold(`${"Suite".padEnd(8)}${"Result".padEnd(10)}${"Explored".padEnd(14)}${"Actions".padEnd(10)}Time`));
const summaries = suites.map(summarise);
for (const s of summaries) {
  const explored = s.states !== undefined ? `${s.states} states` : "-";
  const time = s.seconds !== undefined ? `${s.seconds.toFixed(1)}s` : "-";
  console.log(`${s.suite.padEnd(8)}${badge(s.status)}${" ".repeat(10 - s.status.length)}${explored.padEnd(14)}${String(s.actions ?? "-").padEnd(10)}${time}`);
}

for (const s of summaries) {
  console.log(line);
  console.log(`${bold(s.suite)}  ${badge(s.status)}  ${dim(specs[s.suite] ?? "")}`);
  if (s.status === "NOT RUN") {
    console.log(dim("  not run in this invocation"));
    continue;
  }
  const failed = new Map(s.violations.map((v) => [v.name, v]));
  for (const name of s.properties) {
    const v = failed.get(name);
    if (!v) {
      console.log(`  ${green("✓")} ${name}`);
      continue;
    }
    console.log(`  ${red("✗")} ${bold(name)}`);
    console.log(`      first violated at state #${v.index} (${v.at}s), ${v.after ? `after ${v.after}` : "in the initial state"}`);
    if (v.message) console.log(dim(`      ${v.message}`));
  }
  for (const v of s.violations.filter((v) => !s.properties.includes(v.name))) {
    console.log(`  ${red("✗")} ${bold(v.name)} at state #${v.index}`);
  }
  if (s.status === "FAIL") {
    console.log(dim(`  The run stopped at the first violation; ✓ means no violation up to that point.`));
    const cmd = s.suite === "web" ? "browser inspect" : "trace --screen";
    console.log(`  Replay: ${bold(`npx bombadil ${cmd} results/${s.suite}.trace`)}`);
  }
  if (s.status === "ERROR") {
    console.log(yellow(`  Bombadil exited with code ${s.exitCode} without a violation. Last log lines:`));
    console.log(dim(s.logTail.replace(/^/gm, "    ")));
  }
}

const passed = summaries.filter((s) => s.status === "PASS").length;
const failed = summaries.length - passed;
console.log(line);
console.log(
  `${bold("Overall:")} ${failed === 0 ? green(bold("PASS")) : red(bold("FAIL"))}  ` +
    `${passed} of ${summaries.length} suite(s) passed`,
);
console.log();
process.exit(failed === 0 ? 0 : 1);
