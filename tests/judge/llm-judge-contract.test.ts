/**
 * tests/judge/llm-judge-contract.test.ts
 *
 * AC-8 (FEAT-184): A single mock LLMJudge satisfies both the evals/run-eval.ts
 * call shape and a synthetic rubricScorer call. This proves the interface is
 * genuinely shared and not bifurcated.
 *
 * The mock implements the full canonical LLMJudge shape from FEAT-184:
 *   evaluate(opts: { candidateOutput, expected, rubric: string[], signal?, context? })
 *   => { pass, score, rubricScores, rationale, cost_usd, latency_ms, tokens?, raw? }
 *   describe() => { provider, model }
 *
 * Two synthetic call sites:
 *   1. "evals/run-eval.ts" call shape: rubric wrapped in single-element array (AC-5),
 *      context forwarded (AC-6), tokens present on result (AC-1 telemetry).
 *   2. "rubricScorer" call shape: multi-criterion rubric array, expected EvalCase,
 *      rubricScores accessed per criterion.
 */

import { describe, expect, test } from "bun:test";
import type { LLMJudge } from "../../src/interfaces.ts";
import type { EvalCase } from "../../src/types/index.ts";

// ---------------------------------------------------------------------------
// Mock implementation — single class satisfying both call sites
// ---------------------------------------------------------------------------

class MockLLMJudge implements LLMJudge {
  readonly callLog: Array<Parameters<LLMJudge["evaluate"]>[0]> = [];

  async evaluate(opts: Parameters<LLMJudge["evaluate"]>[0]): ReturnType<LLMJudge["evaluate"]> {
    this.callLog.push(opts);

    // Build rubricScores keyed by each rubric criterion
    const rubricScores: Record<string, number> = {};
    for (const criterion of opts.rubric) {
      rubricScores[criterion] = 0.9;
    }

    return {
      pass: true,
      score: 0.9,
      rubricScores,
      rationale: "Mock judge: candidate satisfies all rubric criteria.",
      cost_usd: 0.0002,
      latency_ms: 42,
      tokens: { in: 150, out: 30 },
      raw: { mock: true, rubric: opts.rubric },
    };
  }

  describe(): { provider: string; model: string } {
    return { provider: "mock", model: "mock-v1" };
  }
}

// ---------------------------------------------------------------------------
// Synthetic EvalCase (mirrors gepa-core EvalCase schema)
// ---------------------------------------------------------------------------

function makeEvalCase(): EvalCase {
  return {
    id: "test-case-001",
    input: { fixture: "Hello, I am a fullstack developer." },
    expected_output: { pass: true },
    held_out: false,
  };
}

// ---------------------------------------------------------------------------
// AC-8 contract tests
// ---------------------------------------------------------------------------

describe("LLMJudge contract (AC-8, FEAT-184)", () => {
  test("mock satisfies LLMJudge TypeScript interface", () => {
    // TypeScript structural check — if MockLLMJudge doesn't satisfy LLMJudge
    // this file will fail to typecheck, catching interface drift.
    const judge: LLMJudge = new MockLLMJudge();
    expect(typeof judge.evaluate).toBe("function");
    expect(typeof judge.describe).toBe("function");
  });

  test("evals/run-eval.ts call shape: single-element rubric wrap (AC-5), context forwarded (AC-6)", async () => {
    const judge = new MockLLMJudge();
    const expected = makeEvalCase();

    // AC-5: prose rubric string wrapped in single element — never sentence-split
    const prosRubric =
      "The response must include a DONE status line and a Files: section with at least one path.";
    const wrappedRubric = [prosRubric]; // single-element wrap

    const result = await judge.evaluate({
      candidateOutput: "DONE: shipped.\nFiles: evals/lib/judge.ts",
      expected,
      rubric: wrappedRubric,
      context: { fixture: "crew-fullstack-dev", promptId: "fullstack-dev", version: "v1.2.3" },
    });

    // Result shape assertions
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(typeof result.rationale).toBe("string");
    expect(typeof result.cost_usd).toBe("number");
    expect(typeof result.latency_ms).toBe("number");
    expect(result.rubricScores).toBeDefined();

    // AC-1: tokens present — load-bearing for cost-attribution telemetry
    expect(result.tokens).toBeDefined();
    expect(typeof result.tokens?.in).toBe("number");
    expect(typeof result.tokens?.out).toBe("number");

    // raw present — load-bearing for Langfuse emit
    expect(result.raw).toBeDefined();

    // AC-6: context was forwarded (check it reached the call)
    const call = judge.callLog[0];
    expect(call).toBeDefined();
    expect(call?.context?.fixture).toBe("crew-fullstack-dev");
    expect(call?.context?.promptId).toBe("fullstack-dev");
    expect(call?.context?.version).toBe("v1.2.3");

    // AC-5: rubric arrived as single-element array, original string preserved verbatim
    expect(call?.rubric).toHaveLength(1);
    expect(call?.rubric[0]).toBe(prosRubric);
  });

  test("rubricScorer call shape: multi-criterion array, expected EvalCase, rubricScores per criterion", async () => {
    const judge = new MockLLMJudge();
    const expected = makeEvalCase();

    const criteria = [
      "Response includes a status badge",
      "Response lists changed files",
      "Response includes a Risks section",
    ];

    const result = await judge.evaluate({
      candidateOutput: "DONE: shipped\nFiles: foo.ts\nRisks: none",
      expected,
      rubric: criteria,
    });

    // rubricScores must have an entry per criterion
    expect(Object.keys(result.rubricScores)).toHaveLength(criteria.length);
    for (const criterion of criteria) {
      expect(criterion in result.rubricScores).toBe(true);
      const s = result.rubricScores[criterion] ?? 0;
      expect(typeof s).toBe("number");
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }

    // AbortSignal optional — not required for the basic shape
    expect(result.pass).toBe(true);
  });

  test("signal forwarding: AbortSignal accepted without error", async () => {
    const judge = new MockLLMJudge();
    const ctrl = new AbortController();

    await expect(
      judge.evaluate({
        candidateOutput: "some output",
        expected: makeEvalCase(),
        rubric: ["output must be non-empty"],
        signal: ctrl.signal,
      }),
    ).resolves.toBeDefined();
  });

  test("describe() returns provider + model (AC-3 shape)", () => {
    const judge = new MockLLMJudge();
    const desc = judge.describe();
    expect(typeof desc.provider).toBe("string");
    expect(typeof desc.model).toBe("string");
    expect(desc.provider.length).toBeGreaterThan(0);
    expect(desc.model.length).toBeGreaterThan(0);
  });

  test("tokens undefined is valid (adapters that cannot surface token counts)", async () => {
    // An adapter that omits tokens still satisfies the interface
    const minimalJudge: LLMJudge = {
      async evaluate() {
        return {
          pass: false,
          score: 0,
          rubricScores: {},
          rationale: "no",
          cost_usd: 0,
          latency_ms: 0,
          // tokens intentionally omitted — optional field
        };
      },
      describe: () => ({ provider: "minimal", model: "none" }),
    };

    const result = await minimalJudge.evaluate({
      candidateOutput: "",
      expected: makeEvalCase(),
      rubric: [],
    });

    expect(result.tokens).toBeUndefined();
    expect(result.pass).toBe(false);
  });
});
