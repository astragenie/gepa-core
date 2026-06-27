import type { RunnerAdapter } from "../interfaces.ts";
import type { Trial } from "../types/trial.ts";
import { newTrialId } from "../types/trial.ts";
import { validateCandidateSize } from "../validators/candidate-size.ts";

export function sequentialRunner(opts: { maxCandidateLines?: number } = {}): RunnerAdapter {
  const max = opts.maxCandidateLines ?? 350;
  return {
    async runCandidates(candidates, cases, scorer, { meter, signal }) {
      const trials: Trial[] = [];

      for (const candidate of candidates) {
        // Pre-screen: validateCandidateSize reads the file at prompt_path.
        // Wrap in try/catch so a missing or unreadable file is treated as
        // an oversized/invalid candidate (skip without LLM spend).
        let sizeOk: boolean;
        try {
          const sizeCheck = validateCandidateSize(candidate, max);
          sizeOk = sizeCheck.ok;
        } catch {
          // File unreadable or missing — skip candidate silently.
          sizeOk = false;
        }
        if (!sizeOk) continue;

        for (const c of cases) {
          if (signal?.aborted) return trials;

          const reservation = await meter.reserve(0.02);
          if (!reservation.ok) return trials;

          const startedAt = Date.now();
          const score = await scorer.score(
            {
              agent: candidate.agent,
              candidate_prompt_path: candidate.prompt_path,
              case_id: c.id,
              raw_output: null,
              cost_usd: 0,
              latency_ms: 0,
              finished_at: new Date().toISOString(),
            },
            c,
          );

          await meter.record(reservation.reservationId, score.cost_usd);

          trials.push({
            id: newTrialId(),
            agent: candidate.agent,
            phase: "build",
            candidate_prompt_hash: candidate.prompt_hash,
            candidate_prompt_path: candidate.prompt_path,
            input: c.input,
            output: null,
            score,
            source: "eval",
            pareto_rank: null,
            created_at: new Date(startedAt).toISOString(),
          });
        }
      }

      return trials;
    },
  };
}
