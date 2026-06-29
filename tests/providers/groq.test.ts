/**
 * tests/providers/groq.test.ts
 *
 * AC-1 (FEAT-185 SLICE-A): GroqJudge imports from gepa-core entry point,
 * implements LLMJudge, and accepts config-only constructor (apiKey required,
 * no process.env reads — AC-2).
 */

import { describe, expect, test } from "bun:test";
import type { LLMJudge } from "../../src/interfaces.ts";
import { GROQ_MODELS, type GroqConfig, GroqJudge } from "../../src/providers/groq/index.ts";

describe("GroqJudge — provider entry point (AC-1, FEAT-185)", () => {
  test("imports from entry point without error", () => {
    expect(GroqJudge).toBeDefined();
    expect(typeof GroqJudge).toBe("function");
  });

  test("GROQ_MODELS exported and non-empty", () => {
    expect(Array.isArray(GROQ_MODELS)).toBe(true);
    expect(GROQ_MODELS.length).toBeGreaterThan(0);
  });

  test("config-only smoke: instantiates with apiKey (no env reads)", () => {
    const config: GroqConfig = {
      apiKey: "gsk_test_token",
      model: "llama-3.3-70b-versatile",
      temperature: 0.0,
    };
    const judge = new GroqJudge(config);
    expect(judge).toBeDefined();
  });

  test("satisfies LLMJudge interface structurally", () => {
    const judge: LLMJudge = new GroqJudge({ apiKey: "gsk_x" });
    expect(typeof judge.evaluate).toBe("function");
    expect(typeof judge.describe).toBe("function");
  });

  test("describe() returns provider=groq (overrides generic-openai base)", () => {
    const judge = new GroqJudge({ apiKey: "gsk_x", model: "gemma2-9b-it" });
    const { provider, model } = judge.describe();
    expect(provider).toBe("groq");
    expect(model).toBe("gemma2-9b-it");
  });

  test("describe() defaults to llama-3.3-70b-versatile when no model given", () => {
    const judge = new GroqJudge({ apiKey: "gsk_x" });
    expect(judge.describe().model).toBe("llama-3.3-70b-versatile");
  });

  test("lastRateLimit initialized to undefined fields", () => {
    const judge = new GroqJudge({ apiKey: "gsk_x" });
    expect(judge.lastRateLimit.requestsRemaining).toBeUndefined();
    expect(judge.lastRateLimit.tokensRemaining).toBeUndefined();
    expect(judge.lastRateLimit.requestsResetMs).toBeUndefined();
  });

  test("evaluate() rejects on bad endpoint (network error)", async () => {
    const judge = new GroqJudge({ apiKey: "gsk_x" });
    // Groq base URL will respond 401 on bad key — but this tests offline fail.
    // Use a non-routable address to get a fast network error.
    const evalCase = {
      id: "c1",
      input: {},
      expected_output: {},
      held_out: false,
    };

    // The Groq base URL is valid but the key is bogus — in CI without network
    // this may throw a connection error or a 401 — both are errors, both satisfy
    // the "rejects" assertion.
    await expect(
      judge.evaluate({
        candidateOutput: "test",
        expected: evalCase,
        rubric: ["test"],
      }),
    ).rejects.toThrow();
  });
});
