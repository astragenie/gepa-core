/**
 * OllamaJudge: local/offline judge via Ollama /api/chat endpoint.
 * Native fetch — no npm dependencies.
 *
 * Ported from dev-team evals/providers/ollama.ts (FEAT-185 SLICE-A).
 * Constructor accepts config only — NO process.env access (env reads stay
 * in the dev-team shim that wraps this class).
 *
 * SLICE-89 (FEAT-169 SLICE-B2): original implementation.
 * SLICE-107 (FEAT-184 S2): implements LLMJudge.evaluate() + describe().
 * SLICE-108 (FEAT-185 SLICE-A): relocated to gepa-core/providers/ollama.
 */

import type { LLMJudge } from "../../interfaces.ts";
import type { EvalCase } from "../../types/index.ts";

export interface OllamaConfig {
  /** Ollama base URL (default: http://localhost:11434). */
  host?: string;
  /** Model name (default: llama3.3). */
  model?: string;
  /** Sampling temperature (default: 0.0). */
  temperature?: number;
  /** Request timeout in ms (default: 120000). */
  timeoutMs?: number;
}

const DEFAULT_HOST = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.3";
const DEFAULT_TIMEOUT_MS = 120_000;

interface OllamaChatResponse {
  message: { role: string; content: string };
  done: boolean;
  eval_count?: number;
  prompt_eval_count?: number;
}

function parseJudgeText(text: string): { pass: boolean; score: number; rationale: string } {
  const pass = /^yes/i.test(text.trim());
  const firstBreak = text.indexOf("\n");
  const rationale = firstBreak !== -1 ? text.slice(firstBreak + 1).trim() : text.trim();
  return { pass, score: pass ? 1 : 0, rationale };
}

async function callOllama(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<OllamaChatResponse> {
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
    throw new Error(`OllamaJudge: connection to ${url} failed — is Ollama running? (${msg})`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OllamaJudge: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as OllamaChatResponse;
}

export class OllamaJudge implements LLMJudge {
  private readonly host: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config?: OllamaConfig) {
    this.host = (config?.host ?? DEFAULT_HOST).replace(/\/$/, "");
    this.model = config?.model ?? DEFAULT_MODEL;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  describe(): { provider: string; model: string } {
    return { provider: "ollama", model: this.model };
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

    const url = `${this.host}/api/chat`;
    const data = await callOllama(
      url,
      { model: this.model, messages: [{ role: "user", content: prompt }], stream: false },
      this.timeoutMs,
    );

    const { pass, score, rationale } = parseJudgeText(data.message?.content ?? "");

    return {
      pass,
      score,
      rubricScores: { default: score },
      rationale,
      cost_usd: 0,
      latency_ms: Date.now() - start,
      tokens: {
        in: data.prompt_eval_count ?? 0,
        out: data.eval_count ?? 0,
      },
      raw: data,
    };
  }
}
