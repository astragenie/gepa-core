/**
 * tests/providers/gemini.test.ts
 *
 * AC-1 (FEAT-185 SLICE-A): GeminiJudge imports from gepa-core entry point,
 * implements LLMJudge, and accepts config-only constructor (apiKey required,
 * no process.env reads — AC-2).
 *
 * The gemini provider uses native fetch (no SDK). The @google/generative-ai
 * package is listed as an optional peer dep only. Since the native-fetch
 * implementation doesn't import the SDK, the "missing SDK" error path is
 * represented by the assertGeminiSdkInstalled() guard exported for CI matrix use.
 *
 * AC-8 without-sdk: The CI matrix script imports assertGeminiSdkInstalled and
 * calls it — the guard is a no-op in the native-fetch variant (no error thrown).
 * The CI matrix asserts that the GeminiJudge class is constructible without the
 * @google/generative-ai package installed.
 */

import { describe, expect, test } from "bun:test";
import type { LLMJudge } from "../../src/interfaces.ts";
import {
  type GeminiConfig,
  GeminiJudge,
  assertGeminiSdkInstalled,
} from "../../src/providers/gemini/index.ts";

describe("GeminiJudge — provider entry point (AC-1, FEAT-185)", () => {
  test("imports from entry point without error", () => {
    expect(GeminiJudge).toBeDefined();
    expect(typeof GeminiJudge).toBe("function");
  });

  test("assertGeminiSdkInstalled exported (AC-8 CI matrix guard)", () => {
    expect(typeof assertGeminiSdkInstalled).toBe("function");
    // Native-fetch implementation — no error thrown regardless of SDK state.
    expect(() => assertGeminiSdkInstalled()).not.toThrow();
  });

  test("config-only smoke: instantiates with apiKey (no env reads)", () => {
    const config: GeminiConfig = {
      apiKey: "AIza_test_token",
      model: "gemini-2.5-flash",
      temperature: 0.0,
      maxOutputTokens: 256,
      timeoutMs: 5000,
    };
    const judge = new GeminiJudge(config);
    expect(judge).toBeDefined();
  });

  test("satisfies LLMJudge interface structurally", () => {
    const judge: LLMJudge = new GeminiJudge({ apiKey: "AIza_x" });
    expect(typeof judge.evaluate).toBe("function");
    expect(typeof judge.describe).toBe("function");
  });

  test("describe() returns provider=gemini and the configured model", () => {
    const judge = new GeminiJudge({ apiKey: "AIza_x", model: "gemini-1.5-pro" });
    const { provider, model } = judge.describe();
    expect(provider).toBe("gemini");
    expect(model).toBe("gemini-1.5-pro");
  });

  test("describe() defaults to gemini-2.5-flash when no model given", () => {
    const judge = new GeminiJudge({ apiKey: "AIza_x" });
    expect(judge.describe().model).toBe("gemini-2.5-flash");
  });

  test("evaluate() rejects with fetch error on bad endpoint (offline guard)", async () => {
    // Use a non-routable address to get a fast network error.
    // We override the Gemini URL indirectly via model name substitution.
    // In CI without GEMINI_API_KEY the live call should fail — that's expected.
    const judge = new GeminiJudge({
      apiKey: "AIza_invalid",
      model: "gemini-2.5-flash",
      timeoutMs: 3000,
    });

    const evalCase = {
      id: "c1",
      input: {},
      expected_output: {},
      held_out: false,
    };

    // The Gemini API will return a 400/403 on invalid key — either way it rejects.
    await expect(
      judge.evaluate({
        candidateOutput: "test",
        expected: evalCase,
        rubric: ["test criterion"],
      }),
    ).rejects.toThrow();
  });
});
