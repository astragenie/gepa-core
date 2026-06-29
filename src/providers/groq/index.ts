/**
 * GroqJudge: free-tier primary judge via Groq API.
 * Extends GenericOpenAIJudge with Groq baseUrl, model defaults, and
 * rate-limit header parsing.
 *
 * Ported from dev-team evals/providers/groq.ts (FEAT-185 SLICE-A).
 * Constructor accepts config only — NO process.env access (env reads stay
 * in the dev-team shim that wraps this class).
 *
 * SLICE-88 (FEAT-169 SLICE-B1): original implementation.
 * SLICE-107 (FEAT-184 S2): implements LLMJudge.evaluate() + describe().
 * SLICE-108 (FEAT-185 SLICE-A): relocated to gepa-core/providers/groq.
 */

import type { LLMJudge } from "../../interfaces.ts";
import type { EvalCase } from "../../types/index.ts";
import { type GenericOpenAIConfig, GenericOpenAIJudge } from "../generic-openai/index.ts";

export type { GenericOpenAIConfig };

const GROQ_BASE_URL = "https://api.groq.com/openai";
const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";

export interface GroqConfig {
  /** Groq API key. Required — no fallback in this class. */
  apiKey: string;
  /** Model name (default: llama-3.3-70b-versatile). */
  model?: string;
  /** Sampling temperature (default: 0.0). */
  temperature?: number;
}

/** Rate-limit metadata parsed from Groq response headers. */
export interface GroqRateLimit {
  requestsRemaining: number | undefined;
  tokensRemaining: number | undefined;
  requestsResetMs: number | undefined;
}

function parseRateLimitHeaders(headers: Headers): GroqRateLimit {
  const reqRem = headers.get("x-ratelimit-remaining-requests");
  const tokRem = headers.get("x-ratelimit-remaining-tokens");
  const reqReset = headers.get("x-ratelimit-reset-requests");
  return {
    requestsRemaining: reqRem !== null ? Number.parseInt(reqRem, 10) : undefined,
    tokensRemaining: tokRem !== null ? Number.parseInt(tokRem, 10) : undefined,
    requestsResetMs: reqReset !== null ? Number.parseInt(reqReset, 10) : undefined,
  };
}

export class GroqJudge extends GenericOpenAIJudge {
  /** Rate-limit state updated after each call. Read-only for callers. */
  lastRateLimit: GroqRateLimit = {
    requestsRemaining: undefined,
    tokensRemaining: undefined,
    requestsResetMs: undefined,
  };

  constructor(config: GroqConfig) {
    super({
      baseUrl: GROQ_BASE_URL,
      apiKey: config.apiKey,
      model: config.model ?? GROQ_DEFAULT_MODEL,
      temperature: config.temperature ?? 0.0,
    });
  }

  override describe(): { provider: string; model: string } {
    return { provider: "groq", model: super.describe().model };
  }

  override async evaluate(
    opts: Parameters<LLMJudge["evaluate"]>[0],
  ): ReturnType<LLMJudge["evaluate"]> {
    const result = await super.evaluate(opts);
    // Rate-limit headers — future wire-up when fetch interception is implemented.
    this.lastRateLimit = parseRateLimitHeaders(new Headers());
    return result;
  }
}

// Expose the Groq model list for tooling/selection UI.
export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gemma2-9b-it",
  "mixtral-8x7b-32768",
] as const;

export type GroqModel = (typeof GROQ_MODELS)[number];

// Re-export EvalCase type for consumers that need it alongside GroqJudge.
export type { EvalCase };
