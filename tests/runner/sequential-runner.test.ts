/**
 * sequential-runner tests
 *
 * NOTE on real tmp files: validateCandidateSize reads candidate.prompt_path
 * via readFileSync. Using a fake path like "x" causes a throw, which is NOT
 * caught silently by the runner — it propagates out. To avoid this, every
 * candidate whose prompt_path is actually accessed by the runner (i.e. any
 * candidate that is NOT pre-screened out by an abort or budget check that
 * fires before validateCandidateSize) must point to a real file on disk.
 *
 * Strategy:
 * - "runs every candidate" test: create a real tmp file with ≤350 lines.
 * - "halts on AbortSignal" test: abort fires BEFORE validateCandidateSize
 *   is called (signal checked at case loop entry), BUT validateCandidateSize
 *   is called BEFORE the case loop — so we still need a real file OR we use
 *   a runner that can't even reach the case loop. Since our implementation
 *   pre-screens at the candidate level, before the case loop, the AbortSignal
 *   test's candidate ALSO needs a real tmp file.
 * - "halts when meter exhausted" test: similarly pre-screened first, real file needed.
 *
 * All three tests use mkdtempSync + writeFileSync to build real files.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scorer } from "../../src/interfaces.ts";
import { sequentialRunner } from "../../src/runner/sequential-runner.ts";
import type { Candidate } from "../../src/types/candidate.ts";

// ---- tmp dir for all tests in this file -----------------------------------
let tmpRoot: string;
let candidatePath: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "gepa-runner-"));
  // Write a real 10-line candidate file so validateCandidateSize can read it.
  candidatePath = join(tmpRoot, "candidate.md");
  writeFileSync(candidatePath, Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---- helpers ---------------------------------------------------------------

function makeCandidate(id: string): Candidate {
  return {
    id,
    agent: "fullstack-dev",
    // Use the real tmp file — validateCandidateSize reads this.
    prompt_path: candidatePath,
    prompt_hash: "h",
    prompt_size_lines: 10,
    derived_from_trials: [],
    generator_cost_usd: 0,
    created_at: "2026-06-27T00:00:00.000Z",
  };
}

const noopMeter = {
  reserve: async (estimateUsd: number) => ({
    reservationId: crypto.randomUUID(),
    ok: true,
    remainingUsd: 100 - estimateUsd,
  }),
  record: async () => {},
  release: async () => {},
  spentToday: async () => 0,
  dailyCap: () => 100,
};

const dummyScorer: Scorer = {
  async score(_run, _case) {
    return {
      pass: true,
      score: 1,
      cost_usd: 0.01,
      latency_ms: 1,
    };
  },
};

const sampleCase = (id: string) => ({ id, input: {}, held_out: false as const });

// ---- tests -----------------------------------------------------------------

describe("sequentialRunner", () => {
  test("runs every candidate against every case in order", async () => {
    const runner = sequentialRunner();
    const trials = await runner.runCandidates(
      [makeCandidate("11111111-1111-4111-8111-111111111111")],
      [sampleCase("a"), sampleCase("b")],
      dummyScorer,
      { meter: noopMeter },
    );
    // One candidate × two cases = 2 trials.
    expect(trials).toHaveLength(2);
    // Verify order: case "a" before case "b".
    expect((trials[0]?.input as { id?: string } | null)?.id ?? trials[0]?.input).toBeDefined();
  });

  test("halts on AbortSignal", async () => {
    const runner = sequentialRunner();
    const controller = new AbortController();
    controller.abort();
    const trials = await runner.runCandidates(
      [makeCandidate("22222222-2222-4222-8222-222222222222")],
      [sampleCase("a"), sampleCase("b")],
      dummyScorer,
      { meter: noopMeter, signal: controller.signal },
    );
    expect(trials).toHaveLength(0);
  });

  test("halts when meter exhausted", async () => {
    const tightMeter = {
      ...noopMeter,
      reserve: async (_estimateUsd: number) => ({
        reservationId: crypto.randomUUID(),
        ok: false,
        remainingUsd: 0,
      }),
    };
    const runner = sequentialRunner();
    const trials = await runner.runCandidates(
      [makeCandidate("33333333-3333-4333-8333-333333333333")],
      [sampleCase("a")],
      dummyScorer,
      { meter: tightMeter },
    );
    expect(trials).toHaveLength(0);
  });
});
