/**
 * tests/providers/azure-openai.test.ts
 *
 * SLICE-109 (FEAT-185 SLICE-B revised): AzureOpenAIJudge relocated from
 * dev-team into gepa-core. Mock fetch to verify URL shape + auth header
 * + LLMJudge contract.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AzureOpenAIJudge } from "../../src/providers/azure-openai/index.ts";

const realFetch = globalThis.fetch;
let capturedRequests: Array<{ url: string; init: RequestInit | undefined }> = [];

function mockFetch(response: object, status = 200): void {
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    capturedRequests.push({ url: String(url), init });
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

const sampleResponse = {
  choices: [
    {
      message: {
        role: "assistant",
        content: JSON.stringify({ pass: true, score: 0.91, rationale: "All criteria met." }),
      },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1200, completion_tokens: 80 },
};

describe("SLICE-109 — AzureOpenAIJudge constructor validation", () => {
  test("throws when endpoint missing", () => {
    expect(() => new AzureOpenAIJudge({ endpoint: "", deployment: "gpt-4o", apiKey: "k" })).toThrow(
      /endpoint is required/,
    );
  });

  test("throws when deployment missing", () => {
    expect(
      () =>
        new AzureOpenAIJudge({
          endpoint: "https://x.openai.azure.com",
          deployment: "",
          apiKey: "k",
        }),
    ).toThrow(/deployment is required/);
  });

  test("throws when apiKey missing", () => {
    expect(
      () =>
        new AzureOpenAIJudge({
          endpoint: "https://x.openai.azure.com",
          deployment: "gpt-4o",
          apiKey: "",
        }),
    ).toThrow(/apiKey is required/);
  });
});

describe("SLICE-109 — AzureOpenAIJudge.describe()", () => {
  test("returns provider=azure-openai and model=<deployment>", () => {
    const judge = new AzureOpenAIJudge({
      endpoint: "https://x.openai.azure.com",
      deployment: "gpt-4o-prod",
      apiKey: "fake-key",
    });
    expect(judge.describe()).toEqual({ provider: "azure-openai", model: "gpt-4o-prod" });
  });
});

describe("SLICE-109 — AzureOpenAIJudge.evaluate() URL + auth shape", () => {
  beforeEach(() => {
    capturedRequests = [];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("URL uses Azure deployment shape with api-version query", async () => {
    mockFetch(sampleResponse);
    const judge = new AzureOpenAIJudge({
      endpoint: "https://my-resource.openai.azure.com",
      deployment: "gpt-4o",
      apiKey: "fake-key",
    });
    await judge.evaluate({
      candidateOutput: "candidate text",
      expected: { id: "c1", input: null, held_out: false },
      rubric: ["criterion-1"],
    });
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.url ?? "").toContain(
      "/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21",
    );
  });

  test("uses api-key header (NOT Authorization Bearer)", async () => {
    mockFetch(sampleResponse);
    const judge = new AzureOpenAIJudge({
      endpoint: "https://x.openai.azure.com",
      deployment: "gpt-4o",
      apiKey: "secret-key",
    });
    await judge.evaluate({
      candidateOutput: "ok",
      expected: { id: "c1", input: null, held_out: false },
      rubric: ["c1"],
    });
    const headers = (capturedRequests[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["api-key"]).toBe("secret-key");
    expect(headers.Authorization).toBeUndefined();
  });

  test("trailing slash on endpoint is normalized", async () => {
    mockFetch(sampleResponse);
    const judge = new AzureOpenAIJudge({
      endpoint: "https://x.openai.azure.com/",
      deployment: "gpt-4o",
      apiKey: "key",
    });
    await judge.evaluate({
      candidateOutput: "ok",
      expected: { id: "c1", input: null, held_out: false },
      rubric: ["c1"],
    });
    expect(capturedRequests[0]?.url ?? "").not.toContain(".com//");
  });

  test("custom apiVersion + temperature flow through", async () => {
    mockFetch(sampleResponse);
    const judge = new AzureOpenAIJudge({
      endpoint: "https://x.openai.azure.com",
      deployment: "gpt-4o",
      apiKey: "key",
      apiVersion: "2025-01-01-preview",
      temperature: 0.5,
    });
    await judge.evaluate({
      candidateOutput: "ok",
      expected: { id: "c1", input: null, held_out: false },
      rubric: ["c1"],
    });
    expect(capturedRequests[0]?.url ?? "").toContain("api-version=2025-01-01-preview");
    const body = JSON.parse(String(capturedRequests[0]?.init?.body ?? "{}"));
    expect(body.temperature).toBe(0.5);
  });
});

describe("SLICE-109 — AzureOpenAIJudge.evaluate() result shape", () => {
  beforeEach(() => {
    capturedRequests = [];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("parses pass/score/rationale from JSON response content", async () => {
    mockFetch(sampleResponse);
    const judge = new AzureOpenAIJudge({
      endpoint: "https://x.openai.azure.com",
      deployment: "gpt-4o",
      apiKey: "key",
    });
    const result = await judge.evaluate({
      candidateOutput: "ok",
      expected: { id: "c1", input: null, held_out: false },
      rubric: ["c1"],
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBe(0.91);
    expect(result.rationale).toBe("All criteria met.");
    expect(result.cost_usd).toBe(0); // Azure cost computed externally
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(result.tokens).toEqual({ in: 1200, out: 80 });
  });

  test("malformed JSON in response content → pass:false / score:0 / rationale carries snippet", async () => {
    mockFetch({
      choices: [
        { message: { role: "assistant", content: "not valid json" }, finish_reason: "stop" },
      ],
    });
    const judge = new AzureOpenAIJudge({
      endpoint: "https://x.openai.azure.com",
      deployment: "gpt-4o",
      apiKey: "key",
    });
    const result = await judge.evaluate({
      candidateOutput: "ok",
      expected: { id: "c1", input: null, held_out: false },
      rubric: ["c1"],
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.rationale).toContain("failed to parse");
  });

  test("HTTP 429 → throws with status in message", async () => {
    mockFetch({ error: { code: "rate_limit" } }, 429);
    const judge = new AzureOpenAIJudge({
      endpoint: "https://x.openai.azure.com",
      deployment: "gpt-4o",
      apiKey: "key",
    });
    await expect(
      judge.evaluate({
        candidateOutput: "ok",
        expected: { id: "c1", input: null, held_out: false },
        rubric: ["c1"],
      }),
    ).rejects.toThrow(/HTTP 429/);
  });

  test("usage absent on response → tokens field omitted (not zeroed)", async () => {
    mockFetch({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({ pass: true, score: 1, rationale: "ok" }),
          },
          finish_reason: "stop",
        },
      ],
    });
    const judge = new AzureOpenAIJudge({
      endpoint: "https://x.openai.azure.com",
      deployment: "gpt-4o",
      apiKey: "key",
    });
    const result = await judge.evaluate({
      candidateOutput: "ok",
      expected: { id: "c1", input: null, held_out: false },
      rubric: ["c1"],
    });
    expect(result.tokens).toBeUndefined();
  });
});

describe("SLICE-109 — zero process.env access", () => {
  test("constructor does not read process.env (enforced by scripts/check-no-env-reads.ts)", () => {
    // Sanity assertion: setting env vars has zero effect on the judge.
    process.env.AZURE_OPENAI_ENDPOINT = "https://wrong-env.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "wrong-env-key";
    process.env.AZURE_OPENAI_DEPLOYMENT = "wrong-env-deployment";
    const judge = new AzureOpenAIJudge({
      endpoint: "https://right-config.azure.com",
      deployment: "right-deployment",
      apiKey: "right-key",
    });
    expect(judge.describe().model).toBe("right-deployment");
    process.env.AZURE_OPENAI_ENDPOINT = undefined;
    process.env.AZURE_OPENAI_API_KEY = undefined;
    process.env.AZURE_OPENAI_DEPLOYMENT = undefined;
  });
});
