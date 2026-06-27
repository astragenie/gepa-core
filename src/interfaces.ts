import type {
  AgentRun,
  Candidate,
  CrewArtifact,
  EvalCase,
  ScoreResult,
  Trial,
} from "./types/index.ts";

// Re-export imported types for downstream consumers that import from interfaces
export type { AgentRun, Candidate, CrewArtifact, EvalCase, ScoreResult, Trial };

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
  record(reservationId: string, actualUsd: number): Promise<void>;
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
export interface LLMJudge {
  evaluate(opts: {
    candidateOutput: unknown;
    expected: EvalCase;
    rubric: string[]; // criteria text shown to the judge model
    signal?: AbortSignal;
  }): Promise<{
    pass: boolean;
    score: number; // 0..1 weighted sum of rubric subscores
    rubricScores: Record<string, number>;
    rationale: string;
    cost_usd: number;
    latency_ms: number;
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
