/**
 * Canonical cost shape across all judge evaluations.
 *
 * Introduced in gepa-core 0.4.0 (FEAT-186 S1) so the evals pipeline
 * (`@astragenie/dev-team evals/cli.ts`) and the gepa pipeline
 * (`@astragenie/gepa-core` Trial capture) agree on one shape before
 * `dailyCapMeter` and per-slice cost reports start consuming it
 * (FEAT-186 S2 / S3).
 *
 * Pure type addition — no behavior change. `LLMJudge.evaluate()` still
 * returns the flat fields it has shipped since 0.2.0 (`cost_usd`,
 * `latency_ms`, `tokens?`); consumers that need the canonical shape
 * extract it via `toJudgeCost(result)` (helper added in S2).
 *
 * Optionality contract: `tokens` and `cache` MUST remain optional.
 * Provider adapters that cannot surface a field (e.g. ollama has no
 * prompt cache today; some adapters discard token counts) leave the
 * field unset rather than fabricate zeros.
 */
export interface JudgeCost {
  /** USD cost of the judge call. Always present. */
  usd: number;

  /** Wall-clock latency in milliseconds. Always present. */
  latency_ms: number;

  /**
   * Token counts from the underlying model call.
   * Optional: some adapters (e.g. `claude-p` subprocess) cannot surface counts.
   */
  tokens?: {
    in: number;
    out: number;
  };

  /**
   * Prompt-cache outcome from the underlying provider.
   * Optional: providers without prompt-cache reporting (ollama, groq) leave unset.
   */
  cache?: {
    hit: boolean;
    /** Tokens that did NOT need to be re-billed because of the cache hit. */
    tokens_saved?: number;
  };
}

/**
 * Extract a canonical `JudgeCost` from an `LLMJudge.evaluate()` result.
 *
 * Bridge helper for FEAT-186 S2 — lets consumers feed an evaluate() result
 * directly into `dailyCapMeter.record()` or into the per-slice cost-report
 * renderer without restating the field map at every call site.
 *
 * Forward-compatible: as new optional fields land on the LLMJudge result
 * shape (e.g. `raw`, `rubricScores`), this helper continues to project just
 * the cost-related subset. Adapters that surface richer cost telemetry
 * (token counts, cache outcomes) pass them through automatically.
 */
export function toJudgeCost(result: {
  cost_usd: number;
  latency_ms: number;
  tokens?: { in: number; out: number };
  cache?: { hit: boolean; tokens_saved?: number };
}): JudgeCost {
  const cost: JudgeCost = {
    usd: result.cost_usd,
    latency_ms: result.latency_ms,
  };
  if (result.tokens !== undefined) cost.tokens = result.tokens;
  if (result.cache !== undefined) cost.cache = result.cache;
  return cost;
}
