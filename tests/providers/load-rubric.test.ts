/**
 * tests/providers/load-rubric.test.ts
 *
 * SLICE-101: per-agent rubric.md loader.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRubric, parseRubricMarkdown } from "../../src/providers/load-rubric.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "load-rubric-"));
}

describe("SLICE-101 — parseRubricMarkdown (H2 convention)", () => {
  test("collects each ## heading as a criterion", () => {
    const md = [
      "# Inspector rubric",
      "",
      "Some preamble prose.",
      "",
      "## Identifies the defect",
      "",
      "The candidate must surface the actual defect in the diff.",
      "",
      "## Tags severity correctly",
      "",
      "CRITICAL / HIGH / MEDIUM / LOW.",
      "",
      "## Recommends a fix",
      "",
      "Actionable, not vague.",
    ].join("\n");
    const criteria = parseRubricMarkdown(md);
    expect(criteria).toEqual([
      "Identifies the defect",
      "Tags severity correctly",
      "Recommends a fix",
    ]);
  });

  test("ignores H3 and lower (sub-explanations of criteria above)", () => {
    const md = ["## Criterion A", "### Sub-detail 1", "### Sub-detail 2", "## Criterion B"].join(
      "\n",
    );
    expect(parseRubricMarkdown(md)).toEqual(["Criterion A", "Criterion B"]);
  });

  test("trims trailing whitespace", () => {
    expect(parseRubricMarkdown("## Has trailing   ")).toEqual(["Has trailing"]);
  });
});

describe("SLICE-101 — parseRubricMarkdown (bullet convention, fallback)", () => {
  test("uses top-level bullets when no H2 headings present", () => {
    const md = [
      "# Inspector rubric",
      "",
      "- Identifies the defect",
      "- Tags severity correctly",
      "- Recommends a fix",
    ].join("\n");
    expect(parseRubricMarkdown(md)).toEqual([
      "Identifies the defect",
      "Tags severity correctly",
      "Recommends a fix",
    ]);
  });

  test("ignores bullets nested under H1/H2 (explanation prose)", () => {
    const md = [
      "## Main criterion",
      "- nested point that is explanation, not a criterion",
      "",
      "- top-level bullet because blank line reset",
    ].join("\n");
    // H2 convention wins — bullet under it is ignored, top-level bullet ignored too.
    expect(parseRubricMarkdown(md)).toEqual(["Main criterion"]);
  });

  test("blank line resets the under-heading flag so subsequent top-level bullets count", () => {
    const md = ["# Title", "", "- bullet A", "- bullet B"].join("\n");
    expect(parseRubricMarkdown(md)).toEqual(["bullet A", "bullet B"]);
  });

  test("empty markdown returns empty array", () => {
    expect(parseRubricMarkdown("")).toEqual([]);
  });
});

describe("SLICE-101 — loadRubric (file integration)", () => {
  test("reads a real file and parses to criteria", async () => {
    const root = tmp();
    const file = join(root, "inspector.md");
    await fs.writeFile(
      file,
      ["## Identifies the defect", "## Tags severity correctly"].join("\n"),
      "utf8",
    );
    const criteria = await loadRubric(file);
    expect(criteria).toEqual(["Identifies the defect", "Tags severity correctly"]);
  });

  test("missing file throws (caller handles absence)", async () => {
    const root = tmp();
    await expect(loadRubric(join(root, "nope.md"))).rejects.toThrow();
  });

  test("custom readFile fn lets tests skip the FS entirely", async () => {
    const criteria = await loadRubric("does/not/matter.md", {
      readFile: async () => "## injected criterion",
    });
    expect(criteria).toEqual(["injected criterion"]);
  });
});
