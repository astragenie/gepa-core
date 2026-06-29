/**
 * tests/providers/ollama.test.ts
 *
 * AC-1 (FEAT-185 SLICE-A): OllamaJudge imports from gepa-core entry point,
 * implements LLMJudge, and accepts config-only constructor.
 * AC-2: No process.env in provider source.
 *
 * Note: Ollama has no SDK peer dep — no "missing SDK" error path to assert.
 * The without-sdk CI matrix cell verifies the import works in all environments.
 */

import { describe, expect, test } from "bun:test";
import type { LLMJudge } from "../../src/interfaces.ts";
import { type OllamaConfig, OllamaJudge } from "../../src/providers/ollama/index.ts";

describe("OllamaJudge — provider entry point (AC-1, FEAT-185)", () => {
  test("imports from entry point without error", () => {
    expect(OllamaJudge).toBeDefined();
    expect(typeof OllamaJudge).toBe("function");
  });

  test("config-only smoke: instantiates with explicit host + model (no env reads)", () => {
    const config: OllamaConfig = {
      host: "http://localhost:11434",
      model: "llama3.3",
      temperature: 0,
      timeoutMs: 5000,
    };
    const judge = new OllamaJudge(config);
    // Must not throw — config-only construction.
    expect(judge).toBeDefined();
  });

  test("satisfies LLMJudge interface structurally", () => {
    const judge: LLMJudge = new OllamaJudge({ host: "http://localhost:11434", model: "test" });
    expect(typeof judge.evaluate).toBe("function");
    expect(typeof judge.describe).toBe("function");
  });

  test("describe() returns provider=ollama and the configured model", () => {
    const judge = new OllamaJudge({ model: "mistral" });
    const { provider, model } = judge.describe();
    expect(provider).toBe("ollama");
    expect(model).toBe("mistral");
  });

  test("describe() defaults to llama3.3 when no model given", () => {
    const judge = new OllamaJudge();
    expect(judge.describe().model).toBe("llama3.3");
  });

  test("instantiates with no config (all defaults)", () => {
    const judge = new OllamaJudge();
    expect(judge).toBeDefined();
    expect(judge.describe().provider).toBe("ollama");
  });

  test("evaluate() rejects with connection error when Ollama not running (offline guard)", async () => {
    const judge = new OllamaJudge({
      host: "http://localhost:19999", // non-existent port
      model: "llama3.3",
      timeoutMs: 2000,
    });

    const evalCase = {
      id: "c1",
      input: {},
      expected_output: {},
      held_out: false,
    };

    await expect(
      judge.evaluate({
        candidateOutput: "test",
        expected: evalCase,
        rubric: ["test criterion"],
      }),
    ).rejects.toThrow(/OllamaJudge/);
  });

  // 0.3.1 patch: regression test for OllamaConfig.temperature wiring.
  // Pre-0.3.1 the field was declared but never forwarded to /api/chat.
  test("evaluate() forwards config.temperature to Ollama /api/chat body", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: unknown = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: "YES\nlooks good" },
          done: true,
          prompt_eval_count: 10,
          eval_count: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const judge = new OllamaJudge({ temperature: 0.7, model: "llama3.3" });
      await judge.evaluate({
        candidateOutput: "test",
        expected: { id: "c1", input: {}, expected_output: {}, held_out: false },
        rubric: ["test criterion"],
      });
      const body = capturedBody as { options?: { temperature?: number } };
      expect(body.options?.temperature).toBe(0.7);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("evaluate() defaults temperature to 0.0 when not configured", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: unknown = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: "YES" },
          done: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const judge = new OllamaJudge({ model: "llama3.3" });
      await judge.evaluate({
        candidateOutput: "test",
        expected: { id: "c1", input: {}, expected_output: {}, held_out: false },
        rubric: ["test criterion"],
      });
      const body = capturedBody as { options?: { temperature?: number } };
      expect(body.options?.temperature).toBe(0.0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
