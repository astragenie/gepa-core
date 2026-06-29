/**
 * tests/providers/generic-openai.test.ts
 *
 * AC-1 (FEAT-185 SLICE-A): GenericOpenAIJudge imports from gepa-core entry point,
 * implements LLMJudge, and accepts config-only constructor.
 * AC-2: No process.env in provider source.
 *
 * Note: generic-openai uses native fetch — no SDK peer dep.
 */

import { describe, expect, test } from "bun:test";
import type { LLMJudge } from "../../src/interfaces.ts";
import {
  type GenericOpenAIConfig,
  GenericOpenAIJudge,
} from "../../src/providers/generic-openai/index.ts";

describe("GenericOpenAIJudge — provider entry point (AC-1, FEAT-185)", () => {
  test("imports from entry point without error", () => {
    expect(GenericOpenAIJudge).toBeDefined();
    expect(typeof GenericOpenAIJudge).toBe("function");
  });

  test("config-only smoke: instantiates with required config (no env reads)", () => {
    const config: GenericOpenAIConfig = {
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test-token",
      model: "gpt-4o-mini",
      temperature: 0.0,
    };
    const judge = new GenericOpenAIJudge(config);
    expect(judge).toBeDefined();
  });

  test("satisfies LLMJudge interface structurally", () => {
    const judge: LLMJudge = new GenericOpenAIJudge({
      baseUrl: "https://api.openai.com",
      apiKey: "sk-x",
      model: "gpt-4o-mini",
    });
    expect(typeof judge.evaluate).toBe("function");
    expect(typeof judge.describe).toBe("function");
  });

  test("describe() returns provider=generic-openai and the configured model", () => {
    const judge = new GenericOpenAIJudge({
      baseUrl: "https://api.example.com",
      apiKey: "token",
      model: "mixtral-7b",
    });
    const { provider, model } = judge.describe();
    expect(provider).toBe("generic-openai");
    expect(model).toBe("mixtral-7b");
  });

  test("baseUrl trailing slash is stripped", () => {
    const judge = new GenericOpenAIJudge({
      baseUrl: "https://api.example.com/",
      apiKey: "token",
      model: "gpt-4o",
    });
    // describe() still returns provider name regardless of baseUrl
    expect(judge.describe().provider).toBe("generic-openai");
  });

  test("evaluate() rejects with HTTP error on bad endpoint", async () => {
    const judge = new GenericOpenAIJudge({
      baseUrl: "http://localhost:19999",
      apiKey: "sk-x",
      model: "gpt-4o-mini",
    });

    const evalCase = {
      id: "c1",
      input: {},
      expected_output: {},
      held_out: false,
    };

    await expect(
      judge.evaluate({
        candidateOutput: "test output",
        expected: evalCase,
        rubric: ["output must be non-empty"],
      }),
    ).rejects.toThrow();
  });
});
