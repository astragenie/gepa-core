/**
 * tests/scorer/rubric-scorer.test.ts
 *
 * SLICE-100 AC-4 + AC-5: rubricScorer wraps an LLMJudge into a Scorer,
 * propagates cost + latency, surfaces malformed-score failure mode after
 * configured retries.
 */

import { describe, expect, test } from "bun:test";
import type { AgentRun, EvalCase, LLMJudge } from "../../src/interfaces.ts";
import { rubricScorer } from "../../src/scorer/rubric-scorer.ts";

function mockJudge(stub: Partial<Awaited<ReturnType<LLMJudge["evaluate"]>>>): LLMJudge {
  return {
    evaluate: async () => ({
      pass: true,
      score: 0.8,
      rubricScores: { "criterion-1": 0.9, "criterion-2": 0.7 },
      rationale: "ok",
      cost_usd: 0,
      latency_ms: 1500,
      ...stub,
    }),
    describe: () => ({ provider: "mock", model: "mock" }),
  };
}

function sequenceJudge(
  ...responses: Partial<Awaited<ReturnType<LLMJudge["evaluate"]>>>[]
): LLMJudge {
  let i = 0;
  return {
    evaluate: async () => {
      const fallback = responses[responses.length - 1];
      const stub = responses[i] ?? fallback ?? {};
      i++;
      return {
        pass: true,
        score: 0.8,
        rubricScores: {},
        rationale: "ok",
        cost_usd: 0,
        latency_ms: 100,
        ...stub,
      };
    },
    describe: () => ({ provider: "mock", model: "mock" }),
  };
}

const sampleRun: AgentRun = {
  agent: "fullstack-dev",
  candidate_prompt_path: "agents/fullstack-dev.md",
  case_id: "case-1",
  raw_output: "candidate response",
  cost_usd: 0,
  latency_ms: 0,
  finished_at: new Date().toISOString(),
};
const sampleCase: EvalCase = {
  id: "case-1",
  input: null,
  rubric: ["criterion-1", "criterion-2"],
  held_out: false,
};

describe("SLICE-100 AC-4 — rubricScorer propagates cost + latency from judge", () => {
  test("happy path: judge response maps to ScoreResult", async () => {
    const judge = mockJudge({});
    const scorer = rubricScorer(judge);
    const result = await scorer.score(sampleRun, sampleCase);
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0.8);
    expect(result.cost_usd).toBe(0);
    expect(result.latency_ms).toBe(1500);
    expect(result.rationale).toBe("ok");
    expect(result.rubric).toEqual({ "criterion-1": 0.9, "criterion-2": 0.7 });
  });

  test("score stays within [0, 1]", async () => {
    const judge = mockJudge({ score: 0.42 });
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test("cost from cloud judge propagates correctly (non-zero)", async () => {
    const judge = mockJudge({ cost_usd: 0.018, latency_ms: 612 });
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    expect(result.cost_usd).toBe(0.018);
    expect(result.latency_ms).toBe(612);
  });
});

describe("SLICE-100 AC-5 — malformed score retries once then fails preserved", () => {
  test("NaN score retries once then returns judge_malformed", async () => {
    const judge = sequenceJudge({ score: Number.NaN }, { score: Number.NaN });
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.rationale).toBe("judge_malformed");
  });

  test("score > 1.0 (out of range) retries once then returns judge_malformed", async () => {
    const judge = sequenceJudge({ score: 1.5 }, { score: 1.5 });
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.rationale).toBe("judge_malformed");
  });

  test("score < 0 (out of range) retries once then returns judge_malformed", async () => {
    const judge = sequenceJudge({ score: -0.1 }, { score: -0.1 });
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.rationale).toBe("judge_malformed");
  });

  test("first call malformed, second call valid → returns the valid result (retry succeeded)", async () => {
    const judge = sequenceJudge(
      { score: Number.NaN },
      { score: 0.75, rationale: "recovered", cost_usd: 0.005, latency_ms: 300 },
    );
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0.75);
    expect(result.rationale).toBe("recovered");
    expect(result.cost_usd).toBe(0.005);
  });

  test("retries:0 disables retry — first malformed = immediate failure", async () => {
    let calls = 0;
    const judge: LLMJudge = {
      evaluate: async () => {
        calls++;
        return {
          pass: true,
          score: Number.NaN,
          rubricScores: {},
          rationale: "ok",
          cost_usd: 0,
          latency_ms: 100,
        };
      },
      describe: () => ({ provider: "mock", model: "mock" }),
    };
    const result = await rubricScorer(judge, { retries: 0 }).score(sampleRun, sampleCase);
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(calls).toBe(1);
  });

  test("judge throws — surfaces error message in rationale after retries exhausted", async () => {
    let calls = 0;
    const judge: LLMJudge = {
      evaluate: async () => {
        calls++;
        throw new Error("judge_unreachable: ollama");
      },
      describe: () => ({ provider: "ollama", model: "llama3.2:latest" }),
    };
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.rationale).toContain("judge_unreachable: ollama");
    expect(calls).toBe(2); // initial + 1 retry
  });
});

describe("SLICE-100 — rubric field assembly", () => {
  test("omits rubric field when rubricScores is empty", async () => {
    const judge = mockJudge({ rubricScores: {} });
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    expect(result.rubric).toBeUndefined();
  });

  test("omits rationale field when judge returns undefined rationale", async () => {
    const judge: LLMJudge = {
      evaluate: async () => ({
        pass: true,
        score: 0.5,
        rubricScores: { c1: 0.5 },
        rationale: "",
        cost_usd: 0,
        latency_ms: 100,
      }),
      describe: () => ({ provider: "mock", model: "mock" }),
    };
    const result = await rubricScorer(judge).score(sampleRun, sampleCase);
    // Empty-string rationale still propagates (it's defined, just empty).
    expect(result.rationale).toBe("");
  });

  test("empty rubric on EvalCase still calls judge (judge handles empty rubric)", async () => {
    const judge = mockJudge({});
    const result = await rubricScorer(judge).score(sampleRun, {
      ...sampleCase,
      rubric: undefined,
    });
    expect(result.pass).toBe(true);
  });
});
