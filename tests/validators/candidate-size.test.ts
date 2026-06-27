import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCandidateSize } from "../../src/validators/candidate-size.ts";

describe("validateCandidateSize", () => {
  test("passes a small candidate", () => {
    const root = mkdtempSync(join(tmpdir(), "gepa-size-"));
    const path = join(root, "small.md");
    writeFileSync(path, "line1\nline2\nline3\n");
    const result = validateCandidateSize(
      {
        id: "11111111-1111-4111-8111-111111111111",
        agent: "x",
        prompt_path: path,
        prompt_hash: "h",
        prompt_size_lines: 3,
        derived_from_trials: [],
        generator_cost_usd: 0,
        created_at: "2026-06-27T00:00:00.000Z",
      },
      350,
    );
    expect(result.ok).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("rejects an oversized candidate", () => {
    const root = mkdtempSync(join(tmpdir(), "gepa-size-"));
    const path = join(root, "big.md");
    writeFileSync(path, "x\n".repeat(400));
    const result = validateCandidateSize(
      {
        id: "11111111-1111-4111-8111-111111111111",
        agent: "x",
        prompt_path: path,
        prompt_hash: "h",
        prompt_size_lines: 400,
        derived_from_trials: [],
        generator_cost_usd: 0,
        created_at: "2026-06-27T00:00:00.000Z",
      },
      350,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("oversized");
    rmSync(root, { recursive: true, force: true });
  });
});
