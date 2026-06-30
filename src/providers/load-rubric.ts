/**
 * loadRubric — parse a per-agent rubric Markdown file into a string[] of
 * criteria suitable for passing to `LLMJudge.evaluate({ rubric })`.
 *
 * SLICE-101 (FEAT-183 S5b). Operators maintain rubrics at
 * `evals/rubrics/<agent>.md` (one file per agent prompt). Criteria are
 * extracted from:
 *   1. `## ` Markdown H2 headings (one criterion per heading), OR
 *   2. Top-level bullet items (`- ` at column 0), if no H2s present.
 *
 * Choose ONE convention per file — mixing H2 + bullets is supported (we
 * concatenate both) but reduces readability. The loader does NOT validate
 * convention; the operator does that at authoring time.
 *
 * H3+ headings are ignored — they're sub-explanations of the criterion
 * above, not criteria themselves.
 *
 * Bullets nested under headings (after a heading) are also ignored — they're
 * explanation prose. Only TOP-LEVEL bullets count when bullets are the
 * convention chosen.
 */

import * as fs from "node:fs/promises";

export interface LoadRubricOpts {
  /** Override the file read — useful for testing. Default: node:fs/promises. */
  readFile?: (path: string) => Promise<string>;
}

/**
 * Load a rubric file from `rubricPath` and return the criteria array.
 * Throws if the file does not exist (caller is expected to handle file
 * absence — the loader does not silently fall back to an empty rubric).
 */
export async function loadRubric(rubricPath: string, opts: LoadRubricOpts = {}): Promise<string[]> {
  const reader = opts.readFile ?? ((p: string) => fs.readFile(p, "utf8"));
  const raw = await reader(rubricPath);
  return parseRubricMarkdown(raw);
}

/**
 * Pure parser — exported separately so callers with already-read content
 * (e.g. tests with inline strings, or in-memory rubric templates) can
 * skip the file read.
 */
export function parseRubricMarkdown(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const headings = collectH2Headings(lines);
  if (headings.length > 0) return headings;
  return collectTopLevelBullets(lines);
}

function collectH2Headings(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match && match[1] !== undefined) {
      out.push(match[1].trim());
    }
  }
  return out;
}

function collectTopLevelBullets(lines: string[]): string[] {
  const out: string[] = [];
  let underHeading = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      underHeading = true;
      continue;
    }
    if (line.length === 0) {
      // Blank line resets the under-heading flag — fresh top-level region.
      underHeading = false;
      continue;
    }
    if (underHeading) continue;
    const match = line.match(/^-\s+(.+?)\s*$/);
    if (match && match[1] !== undefined) {
      out.push(match[1].trim());
    }
  }
  return out;
}
