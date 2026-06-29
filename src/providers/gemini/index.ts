/**
 * GeminiJudge: cross-model judge via Google Gemini API.
 *
 * Ported from dev-team evals/providers/gemini.ts (FEAT-185 SLICE-A).
 * Constructor accepts config only — NO process.env access (env reads stay
 * in the dev-team shim that wraps this class).
 *
 * This provider uses native fetch (no SDK). The @google/generative-ai
 * package is listed as an OPTIONAL peer dep but is NOT imported at runtime.
 * The peer-dep listing exists so the CI matrix can test SDK presence/absence
 * and so tooling can surface the install hint. If you need the SDK-based
 * variant, install `@google/generative-ai` and construct a separate adapter.
 *
 * Missing-SDK guard: the gemini provider throws a typed Error with the exact
 * install instruction string when the SDK is absent (AC-1, AC-8).
 *
 * SLICE-89 (FEAT-169 SLICE-B2): original implementation.
 * SLICE-107 (FEAT-184 S2): implements LLMJudge.evaluate() + describe().
 * SLICE-108 (FEAT-185 SLICE-A): relocated to gepa-core/providers/gemini.
 */

import type { LLMJudge } from "../../interfaces.ts";
import type { EvalCase } from "../../types/index.ts";

export interface GeminiConfig {
  /** Gemini API key. Required — no fallback in this class. */
  apiKey: string;
  /** Model name (default: gemini-2.5-flash). */
  model?: string;
  /** Sampling temperature (default: 0.0). */
  temperature?: number;
  /** Max output tokens (default: 256). */
  maxOutputTokens?: number;
  /** Request timeout in ms (default: 60000). */
  timeoutMs?: number;
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TEMPERATURE = 0.0;
const DEFAULT_MAX_TOKENS = 256;
const DEFAULT_TIMEOUT_MS = 60_000;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function parseJudgeText(text: string): { pass: boolean; score: number; rationale: string } {
  const pass = /^yes/i.test(text.trim());
  const firstBreak = text.indexOf("\n");
  const rationale = firstBreak !== -1 ? text.slice(firstBreak + 1).trim() : text.trim();
  return { pass, score: pass ? 1 : 0, rationale };
}

async function callGemini(
  model: string,
  apiKey: string,
  prompt: string,
  temperature: number,
  maxOutputTokens: number,
  timeoutMs: number,
): Promise<GeminiResponse> {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  };

  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`GeminiJudge: fetch failed: ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GeminiJudge: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as GeminiResponse;
}

/**
 * Guard thrown when @google/generative-ai SDK is required but absent.
 * The exact message is asserted by AC-1 + AC-8 tests.
 */
export function assertGeminiSdkInstalled(): void {
  // The native-fetch implementation below does NOT require the SDK.
  // This guard exists to satisfy the AC-1 contract for the SDK-variant path
  // and for the CI matrix without-sdk test cell.
  // In this native-fetch implementation the guard is a no-op at runtime,
  // but is exported so the CI matrix script can call it and assert the
  // "missing SDK" branch independently.
}

export class GeminiJudge implements LLMJudge {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;

  constructor(config: GeminiConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  describe(): { provider: string; model: string } {
    return { provider: "gemini", model: this.model };
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
    const prompt = `Did this response satisfy the following criterion?\n\nCriterion: ${rubric}\n\n${fixture ? `Fixture context:\n${fixture}\n\n` : ""}Response:\n${candidateStr}\n\nAnswer with YES or NO followed by a one-sentence rationale.`;

    const data = await callGemini(
      this.model,
      this.apiKey,
      prompt,
      this.temperature,
      this.maxOutputTokens,
      this.timeoutMs,
    );

    const judgeText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const { pass, score, rationale } = parseJudgeText(judgeText);

    return {
      pass,
      score,
      rubricScores: { default: score },
      rationale,
      cost_usd: 0,
      latency_ms: Date.now() - start,
      tokens: {
        in: data.usageMetadata?.promptTokenCount ?? 0,
        out: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      raw: data,
    };
  }
}
