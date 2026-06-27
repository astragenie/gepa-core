import { describe, expect, it } from "bun:test";
import { dominates, paretoRank } from "../../src/pareto/rank.ts";
import type { ScoreResult } from "../../src/types/score-result.ts";
import type { Trial } from "../../src/types/trial.ts";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeScore(
  pass: boolean,
  score: number,
  cost_usd: number,
  latency_ms: number,
): ScoreResult {
  return { pass, score, cost_usd, latency_ms };
}

function makeTrial(
  id: string,
  pass: boolean,
  score: number,
  cost_usd: number,
  latency_ms: number,
): Trial {
  return {
    id,
    agent: "test-agent",
    phase: "build",
    candidate_prompt_hash: "abc123",
    candidate_prompt_path: null,
    input: {},
    output: {},
    score: makeScore(pass, score, cost_usd, latency_ms),
    source: "eval",
    pareto_rank: null,
    created_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────
// Test 1: dominates — A dominates B
// A is strictly better on at least one objective and not worse on any.
// MAXIMIZE score, MINIMIZE cost_usd, MINIMIZE latency_ms, pass=true > pass=false
// ──────────────────────────────────────────────

describe("dominates — A dominates B", () => {
  it("returns true when A has better score, equal cost, equal latency, equal pass", () => {
    const a = makeScore(true, 0.9, 0.01, 100);
    const b = makeScore(true, 0.7, 0.01, 100);
    expect(dominates(a, b)).toBe(true);
  });

  it("returns true when A has lower cost, equal score, equal latency, equal pass", () => {
    const a = makeScore(true, 0.8, 0.005, 100);
    const b = makeScore(true, 0.8, 0.02, 100);
    expect(dominates(a, b)).toBe(true);
  });

  it("returns true when A passes and B does not (all else equal)", () => {
    const a = makeScore(true, 0.8, 0.01, 100);
    const b = makeScore(false, 0.8, 0.01, 100);
    expect(dominates(a, b)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Test 2: dominates — no trade-off (neither dominates)
// ──────────────────────────────────────────────

describe("dominates — no trade-off", () => {
  it("returns false when A has better score but worse cost (trade-off)", () => {
    const a = makeScore(true, 0.9, 0.05, 100);
    const b = makeScore(true, 0.7, 0.01, 100);
    // A better on score but worse on cost → neither dominates
    expect(dominates(a, b)).toBe(false);
  });

  it("returns false when A has better score but worse latency", () => {
    const a = makeScore(true, 0.9, 0.01, 300);
    const b = makeScore(true, 0.7, 0.01, 100);
    expect(dominates(a, b)).toBe(false);
  });

  it("returns false when b dominates a (symmetric check)", () => {
    const a = makeScore(true, 0.7, 0.01, 100);
    const b = makeScore(true, 0.9, 0.01, 100);
    expect(dominates(a, b)).toBe(false); // b dominates a, not a dominates b
  });
});

// ──────────────────────────────────────────────
// Test 3: paretoRank — all rank-1 when no trial dominates another
// ──────────────────────────────────────────────

describe("paretoRank — all rank-1", () => {
  it("assigns rank 1 to all when no trial dominates any other (trade-off set)", () => {
    const trials = [
      makeTrial("a", true, 0.9, 0.1, 100), // best score, worst cost
      makeTrial("b", true, 0.7, 0.01, 100), // best cost, middling score
      makeTrial("c", true, 0.8, 0.05, 50), // best latency
    ];
    const ranked = paretoRank(trials);
    expect(ranked.length).toBe(3);
    for (const r of ranked) {
      expect(r.pareto_rank).toBe(1);
    }
  });

  it("assigns rank 1 to a single trial", () => {
    const trials = [makeTrial("solo", true, 0.8, 0.01, 100)];
    const ranked = paretoRank(trials);
    expect(ranked[0]?.pareto_rank).toBe(1);
  });
});

// ──────────────────────────────────────────────
// Test 4: paretoRank — dominated trial ranks below
// ──────────────────────────────────────────────

describe("paretoRank — dominated trial ranks below", () => {
  it("assigns rank > 1 to a trial dominated by another", () => {
    const champion = makeTrial("champ", true, 0.9, 0.01, 100);
    const dominated = makeTrial("weak", true, 0.7, 0.01, 100);
    // champion is strictly better on score and not worse on anything
    const ranked = paretoRank([champion, dominated]);
    const champRanked = ranked.find((r) => r.id === "champ");
    const weakRanked = ranked.find((r) => r.id === "weak");
    expect(champRanked?.pareto_rank).toBe(1);
    expect(weakRanked?.pareto_rank).toBeGreaterThan(1);
  });

  it("cascades correctly: rank-2 trial is dominated only by rank-1, not by rank-2", () => {
    // rank1: high score, low cost, low latency
    const r1 = makeTrial("r1", true, 0.9, 0.01, 100);
    // r2: dominated by r1 (score worse), but r2 is not dominated by r3
    const r2 = makeTrial("r2", true, 0.7, 0.01, 100);
    // r3: dominated by both r1 and r2
    const r3 = makeTrial("r3", true, 0.5, 0.01, 100);

    const ranked = paretoRank([r1, r2, r3]);
    const byId = Object.fromEntries(ranked.map((r) => [r.id, r.pareto_rank]));
    expect(byId.r1).toBe(1);
    expect(byId.r2).toBe(2);
    expect(byId.r3).toBe(3);
  });
});

// ──────────────────────────────────────────────
// Test 5: tiebreaker chain — pass > score > -cost > -latency > id
// ──────────────────────────────────────────────

describe("tiebreaker — favors pass > score > -cost > -latency", () => {
  it("among rank-1 trials, pass=true sorts before pass=false", () => {
    const passing = makeTrial("passing", true, 0.8, 0.01, 100);
    const failing = makeTrial("failing", false, 0.8, 0.01, 100);
    const ranked = paretoRank([failing, passing]);
    // Both are rank 1 (neither dominates in Pareto sense with different pass values
    // but the tiebreaker puts passing first in deterministic output order)
    // The tiebreaker is visible via the sort order of the returned array
    const passingIdx = ranked.findIndex((r) => r.id === "passing");
    const failingIdx = ranked.findIndex((r) => r.id === "failing");
    expect(passingIdx).toBeLessThan(failingIdx);
  });

  it("among pass-equal rank-1 trials, higher score sorts first", () => {
    const highScore = makeTrial("high", true, 0.9, 0.01, 100);
    const lowScore = makeTrial("low", true, 0.7, 0.05, 200);
    // trade-off on cost and latency → both rank-1
    const ranked = paretoRank([lowScore, highScore]);
    expect(ranked[0]?.id).toBe("high");
  });

  it("among equal pass + score, lower cost sorts first", () => {
    const cheapOne = makeTrial("cheap", true, 0.8, 0.01, 200);
    const expensiveOne = makeTrial("expensive", true, 0.8, 0.05, 50);
    // trade-off on latency → both rank-1
    const ranked = paretoRank([expensiveOne, cheapOne]);
    expect(ranked[0]?.id).toBe("cheap");
  });

  it("among equal pass + score + cost, lower latency sorts first", () => {
    const fast = makeTrial("fast", true, 0.8, 0.01, 50);
    const slow = makeTrial("slow", true, 0.8, 0.01, 200);
    // identical everything except latency → dominated? No: fast dominates slow.
    // This test confirms the ordering when latency is the only differentiator.
    // fast dominates slow, so slow gets rank > 1.
    const ranked = paretoRank([slow, fast]);
    const fastRanked = ranked.find((r) => r.id === "fast");
    const slowRanked = ranked.find((r) => r.id === "slow");
    expect(fastRanked?.pareto_rank).toBe(1);
    expect(slowRanked?.pareto_rank).toBeGreaterThan(1);
  });

  it("id is final tiebreaker for fully identical metrics", () => {
    // Two trials with identical scores → alphabetical id breaks tie
    const alpha = makeTrial("alpha-id", true, 0.8, 0.01, 100);
    const zeta = makeTrial("zeta-id", true, 0.8, 0.01, 100);
    // alpha dominates zeta? score same, cost same, latency same, pass same → neither
    // both rank-1, but alpha sorts before zeta by id
    const ranked = paretoRank([zeta, alpha]);
    expect(ranked[0]?.id).toBe("alpha-id");
  });
});
