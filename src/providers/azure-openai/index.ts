/**
 * AzureOpenAIJudge: cross-model judge via Azure OpenAI Service.
 * Native fetch — no npm dependencies.
 *
 * SLICE-109 (FEAT-185 SLICE-B revised): relocated from dev-team
 * evals/providers/azure-openai.ts. Constructor accepts config only —
 * NO process.env access (env reads stay in the dev-team shim that
 * wraps this class).
 *
 * Azure differs from standard OpenAI in two ways:
 *   1. Auth header: `api-key`, NOT `Authorization: Bearer`.
 *   2. URL shape: ${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}
 *
 * Bedrock judge is intentionally NOT included — per FEAT-183 wave-plan
 * Q3 (operator decision 2026-06-30), bedrock is dropped entirely until
 * an external consumer requests it.
 */

import type { LLMJudge } from "../../interfaces.ts";
import type { EvalCase } from "../../types/index.ts";

export interface AzureOpenAIConfig {
  /** Azure resource endpoint (no trailing slash). Required. */
  endpoint: string;
  /** Azure deployment name. Required. */
  deployment: string;
  /** API key. Required. */
  apiKey: string;
  /** OpenAI API version (default: "2024-10-21"). */
  apiVersion?: string;
  /** Sampling temperature (default: 0.0). */
  temperature?: number;
  /** Request timeout in ms (default: 120000). */
  timeoutMs?: number;
}

const DEFAULT_API_VERSION = "2024-10-21";
const DEFAULT_TEMPERATURE = 0.0;
const DEFAULT_TIMEOUT_MS = 120_000;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

interface ChatResponse {
  choices: ChatChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export class AzureOpenAIJudge implements LLMJudge {
  private readonly endpoint: string;
  private readonly deployment: string;
  private readonly apiKey: string;
  private readonly apiVersion: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(config: AzureOpenAIConfig) {
    if (!config.endpoint) {
      throw new Error("AzureOpenAIJudge: config.endpoint is required");
    }
    if (!config.deployment) {
      throw new Error("AzureOpenAIJudge: config.deployment is required");
    }
    if (!config.apiKey) {
      throw new Error("AzureOpenAIJudge: config.apiKey is required");
    }
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.deployment = config.deployment;
    this.apiKey = config.apiKey;
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  describe(): { provider: string; model: string } {
    return { provider: "azure-openai", model: this.deployment };
  }

  async evaluate(opts: {
    candidateOutput: unknown;
    expected: EvalCase;
    rubric: string[];
    signal?: AbortSignal;
    context?: { fixture?: string; promptId?: string; version?: string };
  }): Promise<{
    pass: boolean;
    score: number;
    rubricScores: Record<string, number>;
    rationale: string;
    cost_usd: number;
    latency_ms: number;
    tokens?: { in: number; out: number };
    raw?: unknown;
  }> {
    const start = Date.now();
    const rubricText = opts.rubric.join("\n");
    const candidateStr =
      typeof opts.candidateOutput === "string"
        ? opts.candidateOutput
        : JSON.stringify(opts.candidateOutput);
    const messages = buildPrompt(rubricText, candidateStr, opts.context?.fixture);

    const data = await this.callAzure(messages, opts.signal);
    const parsed = parseChatResponse(data);

    const result: Awaited<ReturnType<LLMJudge["evaluate"]>> = {
      pass: parsed.pass,
      score: parsed.score,
      rubricScores: { default: parsed.score },
      rationale: parsed.rationale,
      cost_usd: 0,
      latency_ms: Date.now() - start,
      raw: data,
    };
    if (data.usage) {
      result.tokens = {
        in: data.usage.prompt_tokens,
        out: data.usage.completion_tokens,
      };
    }
    return result;
  }

  private buildUrl(): string {
    return `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;
  }

  private async callAzure(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResponse> {
    const controller = new AbortController();
    const linked = linkSignal(signal, controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.buildUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify({
          model: this.deployment,
          temperature: this.temperature,
          messages,
        }),
        signal: linked,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AzureOpenAIJudge HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return (await res.json()) as ChatResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildPrompt(rubric: string, candidateOutput: string, fixture?: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are an expert evaluator. Given a rubric and a candidate response, " +
        "decide if the candidate PASSES. Reply with JSON: " +
        '{"pass": true|false, "score": 0.0..1.0, "rationale": "<one sentence>"}',
    },
    {
      role: "user",
      content: `Rubric: ${rubric}\n\nCandidate output:\n${candidateOutput}${
        fixture ? `\n\nFixture context: ${fixture}` : ""
      }`,
    },
  ];
}

function parseChatResponse(data: ChatResponse): {
  pass: boolean;
  score: number;
  rationale: string;
} {
  const content = data.choices[0]?.message.content ?? "{}";
  let parsed: { pass?: boolean; score?: number; rationale?: string };
  try {
    parsed = JSON.parse(content) as { pass?: boolean; score?: number; rationale?: string };
  } catch {
    parsed = {
      pass: false,
      score: 0,
      rationale: `failed to parse judge response: ${content.slice(0, 100)}`,
    };
  }
  return {
    pass: parsed.pass ?? false,
    score: parsed.score ?? (parsed.pass ? 1 : 0),
    rationale: parsed.rationale ?? "",
  };
}

function linkSignal(external: AbortSignal | undefined, internal: AbortController): AbortSignal {
  if (!external) return internal.signal;
  if (external.aborted) internal.abort();
  else external.addEventListener("abort", () => internal.abort(), { once: true });
  return internal.signal;
}
