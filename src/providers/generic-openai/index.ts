/**
 * GenericOpenAIJudge: base adapter for any /v1/chat/completions-compatible endpoint.
 * Native fetch — no npm dependencies.
 *
 * Covers: Cerebras, DeepSeek, Mistral, Together, OpenRouter, GitHub Models,
 *         xAI, SambaNova, vLLM, LM Studio — any OpenAI-compatible API.
 *
 * Ported from dev-team evals/providers/generic-openai.ts (FEAT-185 SLICE-A).
 * Constructor accepts config only — NO process.env access (env reads stay
 * in the dev-team shim that wraps this class).
 *
 * SLICE-88 (FEAT-169 SLICE-B1): original implementation.
 * SLICE-107 (FEAT-184 S2): implements LLMJudge.evaluate() + describe().
 * SLICE-108 (FEAT-185 SLICE-A): relocated to gepa-core/providers/generic-openai.
 */

import type { LLMJudge } from "../../interfaces.ts";
import type { EvalCase } from "../../types/index.ts";

export interface GenericOpenAIConfig {
  /** Base URL for the OpenAI-compatible API (e.g. https://api.openai.com). */
  baseUrl: string;
  /** API key / bearer token. */
  apiKey: string;
  /** Model name (e.g. gpt-4o-mini). */
  model: string;
  /** Sampling temperature (default: 0.0). */
  temperature?: number;
  /** Maximum tokens to generate (default: provider default). */
  maxTokens?: number;
}

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
      content: `Rubric: ${rubric}\n\nCandidate output:\n${candidateOutput}${fixture ? `\n\nFixture context: ${fixture}` : ""}`,
    },
  ];
}

async function callChatCompletions(
  url: string,
  authHeader: string,
  model: string,
  temperature: number,
  messages: ChatMessage[],
  maxTokens?: number,
): Promise<ChatResponse> {
  const body: Record<string, unknown> = { model, temperature, messages };
  if (maxTokens !== undefined) {
    body.max_tokens = maxTokens;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GenericOpenAI judge HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as ChatResponse;
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

interface ResolvedConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens?: number;
}

export class GenericOpenAIJudge implements LLMJudge {
  protected readonly config: ResolvedConfig;

  constructor(config: GenericOpenAIConfig) {
    const resolved: ResolvedConfig = {
      baseUrl: config.baseUrl.replace(/\/$/, ""),
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature ?? 0.0,
    };
    if (config.maxTokens !== undefined) {
      resolved.maxTokens = config.maxTokens;
    }
    this.config = resolved;
  }

  describe(): { provider: string; model: string } {
    return { provider: "generic-openai", model: this.config.model };
  }

  async evaluate(opts: {
    candidateOutput: unknown;
    expected: EvalCase;
    rubric: string[];
    signal?: AbortSignal;
    context?: { fixture?: string; promptId?: string; version?: string };
  }): ReturnType<LLMJudge["evaluate"]> {
    const start = Date.now();
    const rubric = opts.rubric.join("\n");
    const candidateStr =
      typeof opts.candidateOutput === "string"
        ? opts.candidateOutput
        : JSON.stringify(opts.candidateOutput);
    const fixture = opts.context?.fixture;

    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const messages = buildPrompt(rubric, candidateStr, fixture);
    const data = await callChatCompletions(
      url,
      `Bearer ${this.config.apiKey}`,
      this.config.model,
      this.config.temperature,
      messages,
      this.config.maxTokens,
    );

    const parsed = parseChatResponse(data);
    const latency_ms = Date.now() - start;

    return {
      pass: parsed.pass,
      score: parsed.score,
      rubricScores: { default: parsed.score },
      rationale: parsed.rationale,
      cost_usd: 0,
      latency_ms,
      tokens: {
        in: data.usage?.prompt_tokens ?? 0,
        out: data.usage?.completion_tokens ?? 0,
      },
      raw: data,
    };
  }
}
