/**
 * tests/algorithms/promotion-gate.test.ts
 *
 * Unit tests for evaluateGate() and DEFAULT_GATE_POLICY.
 *
 * Coverage:
 *   - AC-5: happy path — all 5 gates met → eligible: true, blockedBy: []
 *   - AC-6: tail_risk_block — min_held_out_case_score below floor
 *   - AC-7: min_pass_delta_not_met + not_pareto_rank_1
 *   - champion_frozen: NOT tested here (caller responsibility; no policy field)
 *   - allow_cost/latency_regression flags
 *   - All-fail accumulation: multiple blockers collected, not short-circuited
 */

import { describe, expect, it } from "bun:test";
import {
  type CandidateMetrics,
  type ChampionMetrics,
  DEFAULT_GATE_POLICY,
  type GatePolicy,
  evaluateGate,
} from "../../src/algorithms/promotion-gate.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateMetrics> = {}): CandidateMetrics {
  return {
    pareto_rank: 1,
    held_out_pass: 0.85,
    min_held_out_case_score: 0.65,
    cost_usd_delta: -0.05,
    latency_ms_delta: 0,
    ...overrides,
  };
}

const CHAMPION: ChampionMetrics = { held_out_pass: 0.78 };

// ── AC-5: Happy path ──────────────────────────────────────────────────────────

describe("evaluateGate — happy path (AC-5)", () => {
  it("all 5 gates met → eligible: true, blockedBy: []", () => {
    const decision = evaluateGate(makeCandidate(), CHAMPION, DEFAULT_GATE_POLICY);
    expect(decision.eligible).toBe(true);
    expect(decision.blockedBy).toHaveLength(0);
    expect(decision.events).toHaveLength(0);
  });

  it("detail snapshot populated correctly", () => {
    const decision = evaluateGate(makeCandidate(), CHAMPION, DEFAULT_GATE_POLICY);
    expect(decision.detail.pareto_rank).toBe(1);
    expect(decision.detail.held_out_pass).toBe(0.85);
    expect(decision.detail.champion_held_out_pass).toBe(0.78);
    expect(decision.detail.pass_delta).toBeCloseTo(0.07, 4);
    expect(decision.detail.min_held_out_case_score).toBe(0.65);
    expect(decision.detail.cost_usd_delta).toBe(-0.05);
    expect(decision.detail.latency_ms_delta).toBe(0);
  });
});

// ── AC-6: Tail risk block ─────────────────────────────────────────────────────

describe("evaluateGate — tail risk block (AC-6)", () => {
  it("min_held_out_case_score 0.55 < floor 0.6 → tail_risk_block", () => {
    const decision = evaluateGate(
      makeCandidate({ min_held_out_case_score: 0.55 }),
      CHAMPION,
      DEFAULT_GATE_POLICY,
    );
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toContain("tail_risk_block");
    expect(decision.events).toContain("gepa_tail_risk_block");
  });

  it("min_held_out_case_score exactly 0.6 → passes tail risk gate", () => {
    const decision = evaluateGate(
      makeCandidate({ min_held_out_case_score: 0.6 }),
      CHAMPION,
      DEFAULT_GATE_POLICY,
    );
    expect(decision.blockedBy).not.toContain("tail_risk_block");
  });
});

// ── AC-7: Pass delta + pareto rank ───────────────────────────────────────────

describe("evaluateGate — pass delta + pareto rank (AC-7)", () => {
  it("held_out_pass 0.80 vs champion 0.78 (2pp) < minPassDelta 5pp → min_pass_delta_not_met", () => {
    const decision = evaluateGate(
      makeCandidate({ held_out_pass: 0.8 }),
      CHAMPION,
      DEFAULT_GATE_POLICY,
    );
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toContain("min_pass_delta_not_met");
  });

  it("pareto_rank 2 → not_pareto_rank_1", () => {
    const decision = evaluateGate(makeCandidate({ pareto_rank: 2 }), CHAMPION, DEFAULT_GATE_POLICY);
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toContain("not_pareto_rank_1");
  });

  it("pareto_rank 2 AND 2pp lift → both blockers collected", () => {
    const decision = evaluateGate(
      makeCandidate({ pareto_rank: 2, held_out_pass: 0.8 }),
      CHAMPION,
      DEFAULT_GATE_POLICY,
    );
    expect(decision.blockedBy).toContain("not_pareto_rank_1");
    expect(decision.blockedBy).toContain("min_pass_delta_not_met");
  });

  it("held_out_pass champion + minPassDelta + epsilon → eligible (above boundary)", () => {
    // champion 0.78 + 0.05 + 0.001 = 0.831 → clearly meets threshold
    // (0.83 - 0.78 hits float arithmetic: 0.04999... < 0.05 in IEEE 754)
    const decision = evaluateGate(
      makeCandidate({ held_out_pass: 0.831 }),
      CHAMPION,
      DEFAULT_GATE_POLICY,
    );
    expect(decision.blockedBy).not.toContain("min_pass_delta_not_met");
  });
});

// ── Cost and latency regression ───────────────────────────────────────────────

describe("evaluateGate — cost/latency regression", () => {
  it("positive cost_usd_delta (more expensive) → cost_regression blocked by default", () => {
    const decision = evaluateGate(
      makeCandidate({ cost_usd_delta: 0.1 }),
      CHAMPION,
      DEFAULT_GATE_POLICY,
    );
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toContain("cost_regression");
  });

  it("positive cost_usd_delta with allowCostRegression: true → not blocked", () => {
    const policy: GatePolicy = { ...DEFAULT_GATE_POLICY, allowCostRegression: true };
    const decision = evaluateGate(makeCandidate({ cost_usd_delta: 0.1 }), CHAMPION, policy);
    expect(decision.blockedBy).not.toContain("cost_regression");
  });

  it("positive latency_ms_delta → latency_regression blocked by default", () => {
    const decision = evaluateGate(
      makeCandidate({ latency_ms_delta: 500 }),
      CHAMPION,
      DEFAULT_GATE_POLICY,
    );
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toContain("latency_regression");
  });

  it("positive latency_ms_delta with allowLatencyRegression: true → not blocked", () => {
    const policy: GatePolicy = { ...DEFAULT_GATE_POLICY, allowLatencyRegression: true };
    const decision = evaluateGate(makeCandidate({ latency_ms_delta: 500 }), CHAMPION, policy);
    expect(decision.blockedBy).not.toContain("latency_regression");
  });

  it("zero cost_usd_delta → not blocked (boundary: zero is not a regression)", () => {
    const decision = evaluateGate(
      makeCandidate({ cost_usd_delta: 0 }),
      CHAMPION,
      DEFAULT_GATE_POLICY,
    );
    expect(decision.blockedBy).not.toContain("cost_regression");
  });
});

// ── All-fail accumulation ─────────────────────────────────────────────────────

describe("evaluateGate — all-fail accumulation", () => {
  it("all 5 gates fail → 5 distinct blockedBy entries", () => {
    const worstCandidate: CandidateMetrics = {
      pareto_rank: 3,
      held_out_pass: 0.7, // champion 0.78 → -8pp, and 0.70-0.78 < 0.05
      min_held_out_case_score: 0.4,
      cost_usd_delta: 1.0,
      latency_ms_delta: 1000,
    };
    const decision = evaluateGate(worstCandidate, CHAMPION, DEFAULT_GATE_POLICY);
    expect(decision.eligible).toBe(false);
    expect(decision.blockedBy).toContain("not_pareto_rank_1");
    expect(decision.blockedBy).toContain("min_pass_delta_not_met");
    expect(decision.blockedBy).toContain("tail_risk_block");
    expect(decision.blockedBy).toContain("cost_regression");
    expect(decision.blockedBy).toContain("latency_regression");
    expect(decision.blockedBy).toHaveLength(5);
  });
});

// ── DEFAULT_GATE_POLICY export ────────────────────────────────────────────────

describe("DEFAULT_GATE_POLICY", () => {
  it("matches design spec defaults", () => {
    expect(DEFAULT_GATE_POLICY.minPassDelta).toBe(0.05);
    expect(DEFAULT_GATE_POLICY.minCaseScoreFloor).toBe(0.6);
    expect(DEFAULT_GATE_POLICY.allowCostRegression).toBe(false);
    expect(DEFAULT_GATE_POLICY.allowLatencyRegression).toBe(false);
  });
});
