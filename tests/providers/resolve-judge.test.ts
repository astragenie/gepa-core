/**
 * tests/providers/resolve-judge.test.ts
 *
 * SLICE-101: per-agent judge resolution + factory pattern.
 */

import { describe, expect, test } from "bun:test";
import type { LLMJudge } from "../../src/interfaces.ts";
import {
  type JudgeRegistry,
  resolveJudge,
  resolveJudgeConfig,
} from "../../src/providers/resolve-judge.ts";
import { GepaConfigSchema } from "../../src/types/gepa-config.ts";

function mockLlmJudge(provider: string, model: string): LLMJudge {
  return {
    evaluate: async () => ({
      pass: true,
      score: 1,
      rubricScores: {},
      rationale: "ok",
      cost_usd: 0,
      latency_ms: 0,
    }),
    describe: () => ({ provider, model }),
  };
}

const baseRegistry: JudgeRegistry = {
  ollama: (cfg) => mockLlmJudge("ollama", cfg.model),
  "azure-openai": (cfg) => mockLlmJudge("azure-openai", cfg.model),
  gemini: (cfg) => mockLlmJudge("gemini", cfg.model),
};

describe("SLICE-101 — resolveJudgeConfig", () => {
  test("falls back to top-level judge block when agent has no override", () => {
    const config = GepaConfigSchema.parse({
      judge: { provider: "gemini", model: "gemini-2.5-flash" },
    });
    const resolved = resolveJudgeConfig(config, "fullstack-dev");
    expect(resolved.provider).toBe("gemini");
    expect(resolved.model).toBe("gemini-2.5-flash");
  });

  test("uses judge_per_agent[<agent>] override when present", () => {
    const config = GepaConfigSchema.parse({
      judge: { provider: "ollama", model: "llama3.2:latest" },
      judge_per_agent: {
        inspector: { provider: "azure-openai", model: "gpt-4o", deployment: "prod" },
      },
    });
    const resolved = resolveJudgeConfig(config, "inspector");
    expect(resolved.provider).toBe("azure-openai");
    expect(resolved.model).toBe("gpt-4o");
    expect(resolved.deployment).toBe("prod");
  });

  test("non-overridden agent still falls back to top-level when others have overrides", () => {
    const config = GepaConfigSchema.parse({
      judge: { provider: "ollama", model: "llama3.2:latest" },
      judge_per_agent: {
        inspector: { provider: "gemini", model: "gemini-2.5-flash" },
      },
    });
    const resolved = resolveJudgeConfig(config, "fullstack-dev");
    expect(resolved.provider).toBe("ollama");
  });

  test("optional fields (endpoint, deployment) propagate when set", () => {
    const config = GepaConfigSchema.parse({
      judge: {
        provider: "azure-openai",
        model: "gpt-4o",
        endpoint: "https://example.openai.azure.com",
        deployment: "gpt-4o-prod",
      },
    });
    const resolved = resolveJudgeConfig(config, "any-agent");
    expect(resolved.endpoint).toBe("https://example.openai.azure.com");
    expect(resolved.deployment).toBe("gpt-4o-prod");
  });
});

describe("SLICE-101 — resolveJudge factory dispatch", () => {
  test("returns LLMJudge from registry matching resolved provider", () => {
    const config = GepaConfigSchema.parse({
      judge: { provider: "gemini", model: "gemini-2.5-flash" },
    });
    const judge = resolveJudge(config, "fullstack-dev", baseRegistry);
    expect(judge.describe().provider).toBe("gemini");
    expect(judge.describe().model).toBe("gemini-2.5-flash");
  });

  test("per-agent override picks the right factory", () => {
    const config = GepaConfigSchema.parse({
      judge: { provider: "ollama", model: "llama3.2:latest" },
      judge_per_agent: {
        inspector: { provider: "azure-openai", model: "gpt-4o" },
      },
    });
    const judge = resolveJudge(config, "inspector", baseRegistry);
    expect(judge.describe().provider).toBe("azure-openai");
  });

  test("missing factory throws with helpful error listing known providers", () => {
    const config = GepaConfigSchema.parse({
      judge: { provider: "gemini", model: "gemini-2.5-flash" },
    });
    const partialRegistry: JudgeRegistry = {
      ollama: (cfg) => mockLlmJudge("ollama", cfg.model),
    };
    expect(() => resolveJudge(config, "fullstack-dev", partialRegistry)).toThrow(
      /no factory registered for provider "gemini"/,
    );
    expect(() => resolveJudge(config, "fullstack-dev", partialRegistry)).toThrow(
      /Known providers: ollama/,
    );
  });

  test("opts.apiKey overrides resolved config api_key", () => {
    const config = GepaConfigSchema.parse({
      judge: { provider: "gemini", model: "gemini-2.5-flash" },
    });
    let receivedKey: string | undefined;
    const registry: JudgeRegistry = {
      gemini: (cfg) => {
        receivedKey = cfg.api_key;
        return mockLlmJudge("gemini", cfg.model);
      },
    };
    resolveJudge(config, "fullstack-dev", registry, { apiKey: "secret-key-from-env" });
    expect(receivedKey).toBe("secret-key-from-env");
  });
});
