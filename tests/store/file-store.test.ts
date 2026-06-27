import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore } from "../../src/store/file-store.ts";
import { newTrialId } from "../../src/types/trial.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gepa-filestore-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const sampleTrial = (overrides: Record<string, unknown> = {}) => ({
  id: newTrialId(),
  agent: "fullstack-dev",
  phase: "build" as const,
  candidate_prompt_hash: "abc",
  candidate_prompt_path: null,
  input: { case_id: "c1" },
  output: { ok: true },
  score: { pass: true, score: 1, cost_usd: 0.001, latency_ms: 100 },
  source: "eval" as const,
  pareto_rank: 1,
  created_at: new Date().toISOString(),
  ...overrides,
});

describe("fileStore", () => {
  test("put then recall returns the trial", async () => {
    const store = fileStore(root);
    const trial = sampleTrial();
    await store.put(trial);
    const recalled = await store.recall({ agent: "fullstack-dev" });
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.id).toBe(trial.id);
  });

  test("recall filters by source", async () => {
    const store = fileStore(root);
    await store.put(sampleTrial({ source: "eval" }));
    await store.put(sampleTrial({ source: "captured" }));
    const eval_ = await store.recall({ source: "eval" });
    expect(eval_).toHaveLength(1);
  });

  test("recall filters by failuresOnly", async () => {
    const store = fileStore(root);
    await store.put(sampleTrial({ score: { pass: true, score: 1, cost_usd: 0, latency_ms: 0 } }));
    await store.put(
      sampleTrial({ score: { pass: false, score: 0.2, cost_usd: 0, latency_ms: 0 } }),
    );
    const fails = await store.recall({ failuresOnly: true });
    expect(fails).toHaveLength(1);
    expect(fails[0]?.score.pass).toBe(false);
  });

  test("recall respects limit", async () => {
    const store = fileStore(root);
    for (let i = 0; i < 5; i++) await store.put(sampleTrial());
    const limited = await store.recall({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  test("invalidate by agent returns count purged", async () => {
    const store = fileStore(root);
    await store.put(sampleTrial({ agent: "fullstack-dev" }));
    await store.put(sampleTrial({ agent: "backend-dev" }));
    const purged = await store.invalidate({ agent: "fullstack-dev" });
    expect(purged).toBe(1);
    const remaining = await store.recall({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.agent).toBe("backend-dev");
  });
});
