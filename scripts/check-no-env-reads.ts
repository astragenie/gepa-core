/**
 * AC-2 grep gate: asserts zero process.env reads in src/providers/**\/*.ts.
 *
 * Greps for:
 *   - process.env.X        (dot-access)
 *   - process['env']['X']  (bracket-access variant 1)
 *   - process["env"]["X"]  (bracket-access variant 2)
 *
 * Exits non-zero if any match is found. Intended to run as:
 *   bun run scripts/check-no-env-reads.ts
 *
 * Wire in package.json scripts: "check:no-env": "bun run scripts/check-no-env-reads.ts"
 *
 * FEAT-185 SLICE-A (AC-2).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Regex covers:
//   process.env           — dot-access
//   process['env']        — bracket single-quote
//   process["env"]        — bracket double-quote
const ENV_PATTERN = /process(?:\.env|(?:\['env'\]|\["env"\]))/;

function walkTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

const providersDir = new URL("../src/providers", import.meta.url).pathname;

// On Windows the URL pathname starts with /C:/... — strip leading slash.
const normalizedDir = providersDir.startsWith("/") && providersDir[2] === ":"
  ? providersDir.slice(1)
  : providersDir;

const files = walkTs(normalizedDir);
const hits: Array<{ file: string; line: number; text: string }> = [];

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    // Skip comment lines (JSDoc /** ... */, // ..., and * prefix lines).
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (ENV_PATTERN.test(line)) {
      hits.push({ file: relative(normalizedDir, file), line: i + 1, text: trimmed });
    }
  }
}

if (hits.length > 0) {
  console.error(`[check-no-env-reads] FAIL — ${hits.length} process.env access(es) found in providers:\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.text}`);
  }
  console.error(
    "\nProviders must be config-only. Move env reads to the dev-team shim layer.",
  );
  process.exitCode = 1;
} else {
  console.log("[check-no-env-reads] PASS — zero process.env reads in src/providers/");
}
