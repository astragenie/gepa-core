import { describe, expect, test } from "bun:test";
import { binaryScorer } from "../../src/scorer/binary-scorer.ts";

describe("binaryScorer", () => {
  test("score 1.0 when injected dispatcher returns PASS", async () => {
    const scorer = binaryScorer("inspector", {
      dispatch: async () => ({
        pass: true,
        cost_usd: 0.003,
        latency_ms: 220,
      }),
    });
    const result = await scorer.score(
      {
        agent: "fullstack-dev",
        candidate_prompt_path: "x",
        case_id: "c1",
        raw_output: { ok: true },
        cost_usd: 0,
        latency_ms: 0,
        finished_at: new Date().toISOString(),
      },
      { id: "c1", input: {}, held_out: false },
    );
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1);
  });

  test("score 0.0 when dispatcher returns FAIL", async () => {
    const scorer = binaryScorer("inspector", {
      dispatch: async () => ({ pass: false, cost_usd: 0.003, latency_ms: 200 }),
    });
    const result = await scorer.score(
      {
        agent: "x",
        candidate_prompt_path: "x",
        case_id: "c1",
        raw_output: { ok: false },
        cost_usd: 0,
        latency_ms: 0,
        finished_at: new Date().toISOString(),
      },
      { id: "c1", input: {}, held_out: false },
    );
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
  });
});
