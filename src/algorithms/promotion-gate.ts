/**
 * promotion-gate.ts — 5-condition promotion gate for GEPA candidates.
 *
 * Implements the library API surface from FEAT-183 design spec
 * "Library API surface → Interfaces → PromotionPolicy" (lines 305–316)
 * and the 5-condition promotion gate:
 *
 *   1. pareto_rank === 1   (Pareto-dominant in held-out set)
 *   2. held_out_pass >= champion.held_out_pass + minPassDelta   (meaningful lift)
 *   3. min_held_out_case_score >= minCaseScoreFloor   (tail risk — no single failing case)
 *   4. cost_usd_delta <= 0 (unless allowCostRegression)
 *   5. latency_ms_delta <= 0 (unless allowLatencyRegression)
 *
 * Resolved concern C24 — champion_frozen kill-switch:
 *   The caller checks champion_frozen BEFORE calling evaluateGate; this module
 *   does not know about the frozen list. The precedence rule (optimize.paused
 *   checked first, then champion_frozen) is enforced in the crew CLI layer.
 *
 * All logged event names are returned in PromotionDecision.events so the
 * caller can append them to events.jsonl without this module doing any I/O.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Candidate metrics over the held-out eval set.
 * Caller populates from Trial aggregation after a gepa-eval run.
 */
export interface CandidateMetrics {
  /** Pareto rank among all candidates in this run (1 = dominant). */
  pareto_rank: number;
  /** Pass rate (0..1) on held-out cases. */
  held_out_pass: number;
  /**
   * Minimum score across all held-out cases (0..1).
   * Used by minCaseScoreFloor to detect a single bad case that drags the tail.
   */
  min_held_out_case_score: number;
  /**
   * Δ cost vs champion (negative = cheaper, positive = more expensive).
   * Positive value may block promotion unless allowCostRegression = true.
   */
  cost_usd_delta: number;
  /**
   * Δ latency_ms vs champion (negative = faster, positive = slower).
   * Positive value may block promotion unless allowLatencyRegression = true.
   */
  latency_ms_delta: number;
}

/**
 * Champion snapshot for comparison.
 */
export interface ChampionMetrics {
  /** Pass rate (0..1) on the same held-out cases the candidate was evaluated on. */
  held_out_pass: number;
}

/**
 * Promotion policy controlling all five gate conditions.
 * Mirrors the PromotionPolicy interface in interfaces.ts; repeated here for
 * single-import ergonomics in pure-algorithm consumers.
 */
export interface GatePolicy {
  /** Minimum additional pass rate over champion (e.g. 0.05 = 5 pp). */
  minPassDelta: number;
  /** Any held-out case below this score blocks promotion (tail-risk gate). */
  minCaseScoreFloor: number;
  /** If false, positive cost_usd_delta blocks promotion. */
  allowCostRegression: boolean;
  /** If false, positive latency_ms_delta blocks promotion. */
  allowLatencyRegression: boolean;
}

/**
 * Default PromotionPolicy values matching gepa.config.json defaults and
 * design spec "Library API surface → PromotionPolicy" (lines 305–316).
 */
export const DEFAULT_GATE_POLICY: GatePolicy = {
  minPassDelta: 0.05,
  minCaseScoreFloor: 0.6,
  allowCostRegression: false,
  allowLatencyRegression: false,
};

/**
 * Result of evaluateGate.
 */
export interface PromotionDecision {
  eligible: boolean;
  /**
   * Populated when eligible = false.
   * Each entry is a canonical block-reason key:
   *   "not_pareto_rank_1"      — candidate is not the Pareto-dominant candidate
   *   "min_pass_delta_not_met" — held_out lift below minPassDelta
   *   "tail_risk_block"        — min held-out case score below floor
   *   "cost_regression"        — cost increased and allowCostRegression = false
   *   "latency_regression"     — latency increased and allowLatencyRegression = false
   */
  blockedBy: string[];
  /**
   * Structured event names for appending to events.jsonl.
   * Non-empty only when eligible = false. Caller appends these.
   */
  events: string[];
  /** Snapshot of inputs and decision for forensics artifact. */
  detail: {
    pareto_rank: number;
    held_out_pass: number;
    champion_held_out_pass: number;
    pass_delta: number;
    min_held_out_case_score: number;
    cost_usd_delta: number;
    latency_ms_delta: number;
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Evaluate the 5-condition promotion gate.
 *
 * Order of checks matches design spec gates — all failing conditions are
 * collected (not short-circuit) so the caller can see every reason at once.
 */
export function evaluateGate(
  candidate: CandidateMetrics,
  champion: ChampionMetrics,
  policy: GatePolicy,
): PromotionDecision {
  const blockedBy: string[] = [];
  const events: string[] = [];

  // Gate 1: Pareto rank
  if (candidate.pareto_rank !== 1) {
    blockedBy.push("not_pareto_rank_1");
  }

  // Gate 2: Minimum pass-rate lift
  const passDelta = candidate.held_out_pass - champion.held_out_pass;
  if (passDelta < policy.minPassDelta) {
    blockedBy.push("min_pass_delta_not_met");
  }

  // Gate 3: Tail-risk floor
  if (candidate.min_held_out_case_score < policy.minCaseScoreFloor) {
    blockedBy.push("tail_risk_block");
    events.push("gepa_tail_risk_block");
  }

  // Gate 4: Cost regression
  if (!policy.allowCostRegression && candidate.cost_usd_delta > 0) {
    blockedBy.push("cost_regression");
  }

  // Gate 5: Latency regression
  if (!policy.allowLatencyRegression && candidate.latency_ms_delta > 0) {
    blockedBy.push("latency_regression");
  }

  return {
    eligible: blockedBy.length === 0,
    blockedBy,
    events,
    detail: {
      pareto_rank: candidate.pareto_rank,
      held_out_pass: candidate.held_out_pass,
      champion_held_out_pass: champion.held_out_pass,
      pass_delta: passDelta,
      min_held_out_case_score: candidate.min_held_out_case_score,
      cost_usd_delta: candidate.cost_usd_delta,
      latency_ms_delta: candidate.latency_ms_delta,
    },
  };
}
