import type {
  AgentRun,
  Candidate,
  CrewArtifact,
  EvalCase,
  JudgeCost,
  ScoreResult,
  Trial,
} from "./types/index.ts";

// Re-export imported types for downstream consumers that import from interfaces
export type { AgentRun, Candidate, CrewArtifact, EvalCase, JudgeCost, ScoreResult, Trial };

export interface Scorer {
  score(run: AgentRun, expected: EvalCase): Promise<ScoreResult>;
}

export interface TrialStore {
  put(trial: Trial): Promise<void>;
  recall(filter: {
    agent?: string;
    phase?: string;
    source?: "eval" | "captured" | "soak"; // soak monitor + audit need this
    minScore?: number;
    failuresOnly?: boolean;
    since?: string; // ISO datetime
    limit?: number;
  }): Promise<Trial[]>;
  invalidate(filter: {
    tag?: string;
    trial_ids?: string[];
    agent?: string;
    since?: string;
  }): Promise<number>;
}

export interface RunnerAdapter {
  runCandidates(
    candidates: Candidate[],
    cases: EvalCase[],
    scorer: Scorer,
    opts: { meter: BudgetMeter; signal?: AbortSignal },
  ): Promise<Trial[]>;
}

export interface CandidateGenerator {
  generate(
    currentChampionPath: string,
    failingTrials: Trial[],
    k: number,
    opts: { meter: BudgetMeter },
  ): Promise<Candidate[]>;
}

export interface PromotionPolicy {
  eligibleAgents: string[];
  minPassDelta: number; // 0.05 (5 percentage points over champion)
  minCaseScoreFloor: number; // 0.6 — any held-out case below this blocks promotion
  soakPercent: number; // 0.10 (10 % of real dispatches)
  soakDays: number; // 7 (target clock)
  minSoakTrials: number; // 20 — sample-size floor; soak waits until BOTH clock + this met
  maxSoakDays: number; // 21 — hard cap if traffic too low to reach sample floor; revert if still under
  soakEpsilon: number; // 0.02 — 2 pp tolerance on `soak_pass_rate >= main_pass_rate - epsilon`
  allowCostRegression: boolean;
  allowLatencyRegression: boolean;
}

export interface BudgetMeter {
  reserve(
    estimateUsd: number,
    opts?: { ttlSeconds?: number },
  ): Promise<{
    reservationId: string;
    ok: boolean;
    remainingUsd: number;
  }>;
  /**
   * Record actual cost against a reservation.
   *
   * FEAT-186 S2 (0.4.0) widened the signature to accept the canonical
   * `JudgeCost` shape in addition to a plain `number`. Both call patterns
   * are equivalent at the meter — only `cost.usd` is consumed for
   * accumulator math today. Adapters that surface richer cost fields
   * (`tokens`, `cache`) pass the full `JudgeCost` so future observability
   * extensions can read it without changing this signature.
   *
   * Number form retained for backward compatibility with 0.3.x callers.
   */
  record(reservationId: string, cost: number | JudgeCost): Promise<void>;
  release(reservationId: string): Promise<void>; // explicit cancel
  spentToday(): Promise<number>;
  dailyCap(): number;
}
// Reservations have a default TTL of 600 s; if the caller crashes between
// reserve() and record()/release(), the BudgetMeter expires the reservation
// at TTL and the held budget returns to the daily cap. Built-in `dailyCapMeter`
// persists reservations + TTL to disk so day-roll-over and orphan-recovery
// both work after process restart.

// Pluggable judge interface — `rubricScorer` takes one of these as a dep.
// Consumer plugins pick per `gepa.config.json` `judge` block.
//
// FEAT-184 canonical shape (v0.2.0):
//   - `tokens?: { in, out }` added to result — load-bearing for evals/cli.ts cost-attribution
//     telemetry and Langfuse emission. Single-element rubric arrays are accepted as a
//     degenerate case forever (see AC-5 in FEAT-184): pass `[oneString]` when porting a
//     prose-rubric caller; never sentence-split the string.
//   - `raw?: unknown` added to result — load-bearing for Langfuse debug emission (FEAT-169 SLICE-90).
//   - `context?: { fixture?, promptId?, version? }` added to opts — carries Langfuse
//     provenance fields through evaluate(); must not be dropped by adapters.
export interface LLMJudge {
  evaluate(opts: {
    candidateOutput: unknown;
    expected: EvalCase;
    rubric: string[]; // criteria text shown to the judge model
    signal?: AbortSignal;
    /**
     * Langfuse / observability provenance fields.
     * Adapters MUST forward this to their underlying call or telemetry; never drop it.
     */
    context?: {
      fixture?: string;
      promptId?: string;
      version?: string;
    };
  }): Promise<{
    pass: boolean;
    score: number; // 0..1 weighted sum of rubric subscores
    rubricScores: Record<string, number>;
    rationale: string;
    cost_usd: number;
    latency_ms: number;
    /**
     * Token counts from the underlying model call.
     * Load-bearing for evals/cli.ts cost-attribution telemetry.
     * Optional because some adapters (claude-p subprocess) cannot surface token counts.
     */
    tokens?: { in: number; out: number };
    /**
     * Raw provider response — load-bearing for Langfuse debug emission.
     * Optional because some adapters discard the raw response.
     */
    raw?: unknown;
  }>;
  describe(): { provider: string; model: string }; // for trial provenance
}

// Lockfile coordinator — prevents concurrent `/crew:gepa-eval` or `/crew:gepa-optimize`
// from racing on the same agent (worktree-parallel safety).
export interface LockManager {
  acquire(
    agent: string,
    op: "eval" | "optimize",
  ): Promise<{ released: () => Promise<void> } | null>;
  isLocked(agent: string): Promise<boolean>;
}
