/**
 * rubricScorer — Scorer factory that turns an LLMJudge into a Scorer.
 *
 * SLICE-100 (FEAT-183 S5a): breaks the scorer-circularity that blocked
 * optimizing inspector/verifier/architect in the original ticket framing
 * (architect concern C1). The judge produces a per-criterion score; the
 * scorer assembles a `ScoreResult` for the trial pipeline.
 *
 * Failure modes (per design spec "Judge LLMJudge returns malformed score"):
 *   - NaN, Infinity, or score outside [0, 1] → retry once.
 *   - Second failure → return pass:false / score:0 / rationale:"judge_malformed".
 *     Trial is preserved (never dropped) so the corpus retains a row for
 *     observability + post-hoc analysis.
 */

import type { AgentRun, EvalCase, LLMJudge, ScoreResult, Scorer } from "../interfaces.ts";

export interface RubricScorerOpts {
  /** Override retry count on malformed judge response. Default: 1 retry (= 2 attempts). */
  retries?: number;
}

export function rubricScorer(judge: LLMJudge, opts: RubricScorerOpts = {}): Scorer {
  const retries = opts.retries ?? 1;

  return {
    async score(run: AgentRun, expected: EvalCase): Promise<ScoreResult> {
      const rubric = expected.rubric ?? [];
      let attempt = 0;
      let lastResult: Awaited<ReturnType<LLMJudge["evaluate"]>> | undefined;
      let lastFailureReason = "judge_malformed";

      while (attempt <= retries) {
        try {
          const result = await judge.evaluate({
            candidateOutput: run.raw_output,
            expected,
            rubric,
          });
          lastResult = result;
          const valid = isValidScore(result.score);
          if (valid) {
            return assembleScoreResult(result);
          }
          lastFailureReason = "judge_malformed";
        } catch (err) {
          // Network / SDK failures bubble up only after all retries exhausted.
          // Preserve the underlying message so callers (eval runner) can decide
          // whether to halt the cycle (per design spec "judge_unreachable").
          lastFailureReason = err instanceof Error ? err.message : String(err);
        }
        attempt += 1;
      }

      // All attempts failed. Return a preserved-but-failed ScoreResult so the
      // trial corpus retains a row (per AC-5). Cost + latency are zeroed
      // because the judge never produced a usable answer.
      return {
        pass: false,
        score: 0,
        rationale: lastFailureReason,
        cost_usd: lastResult?.cost_usd ?? 0,
        latency_ms: lastResult?.latency_ms ?? 0,
      };
    },
  };
}

function isValidScore(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function assembleScoreResult(result: Awaited<ReturnType<LLMJudge["evaluate"]>>): ScoreResult {
  const out: ScoreResult = {
    pass: result.pass,
    score: result.score,
    cost_usd: result.cost_usd,
    latency_ms: result.latency_ms,
  };
  if (result.rationale !== undefined) out.rationale = result.rationale;
  if (result.rubricScores && Object.keys(result.rubricScores).length > 0) {
    out.rubric = result.rubricScores;
  }
  return out;
}
