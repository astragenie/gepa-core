import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore } from "../../src/store/file-store.ts";
import { newTrialId } from "../../src/types/trial.ts";

describe("fileStore crash recovery", () => {
  test("torn JSONL line is silently dropped on recall", async () => {
    const root = mkdtempSync(join(tmpdir(), "gepa-crash-"));
    try {
      const store = fileStore(root);
      const trial = {
        id: newTrialId(),
        agent: "x",
        phase: "build" as const,
        candidate_prompt_hash: "a",
        candidate_prompt_path: null,
        input: {},
        output: {},
        score: { pass: true, score: 1, cost_usd: 0, latency_ms: 0 },
        source: "eval" as const,
        pareto_rank: null,
        created_at: "2026-06-27T00:00:00.000Z",
      };
      await store.put(trial);

      // Simulate a SIGKILL during a follow-up put: write a half-line manually.
      const jsonl = `${root}/x.jsonl`;
      const existing = readFileSync(jsonl, "utf8");
      writeFileSync(jsonl, `${existing}{"id":"22222222-2222-4111-8222-222`);

      const recalled = await store.recall({ agent: "x" });
      expect(recalled).toHaveLength(1);
      expect(recalled[0]?.id).toBe(trial.id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
