/**
 * tests/algorithms/soak-monitor.test.ts
 *
 * Unit tests for evaluateSoak() — pure algorithm, no I/O.
 *
 * Virtual clock: all tests inject now_iso and started_at; no real Date.now() calls.
 * Coverage:
 *   - AC-2: dual-clock gate (both clocks must clear)
 *   - AC-3: sample-floor + insufficient-traffic revert at maxSoakDays
 *   - AC-4: early-revert on rolling 1-day window regression
 *   - ROLLING_WINDOW edge: trials older than 1 day are excluded from pass rate
 */

import { describe, expect, it } from "bun:test";
import {
  SOAK_ROLLING_WINDOW_MS,
  type SoakPolicy,
  type SoakState,
  type SoakTrial,
  evaluateSoak,
} from "../../src/algorithms/soak-monitor.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_POLICY: SoakPolicy = {
  soakDays: 7,
  minSoakTrials: 20,
  maxSoakDays: 21,
  soakEpsilon: 0.02,
};

function daysAgo(days: number, from: string): string {
  return new Date(new Date(from).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeTrials(count: number, pass: boolean, created_at: string): SoakTrial[] {
  return Array.from({ length: count }, () => ({
    created_at,
    pass,
    score: pass ? 0.9 : 0.3,
    source: "soak" as const,
  }));
}

// ── AC-2: Dual-clock gate ─────────────────────────────────────────────────────

describe("evaluateSoak — dual-clock gate (AC-2)", () => {
  const NOW = "2026-07-08T12:00:00.000Z";
  const STARTED_7_DAYS_AGO = daysAgo(7, NOW);
  const STARTED_5_DAYS_AGO = daysAgo(5, NOW);

  it("day 5 + 25 trials → running (clock not met)", () => {
    const trials = makeTrials(25, true, STARTED_7_DAYS_AGO); // old enough to count
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_5_DAYS_AGO,
      now_iso: NOW,
      trials,
      main_pass_rate: 0.75,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    expect(verdict.status).toBe("running");
    expect(verdict.elapsed_days).toBeLessThan(7);
    expect(verdict.reason).toContain("elapsed_days");
  });

  it("day 7 + 25 trials → passed (both clocks met)", () => {
    // All trials within rolling window (now)
    const trials = makeTrials(25, true, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_7_DAYS_AGO,
      now_iso: NOW,
      trials,
      main_pass_rate: 0.75,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    expect(verdict.status).toBe("passed");
    expect(verdict.elapsed_days).toBeGreaterThanOrEqual(7);
    expect(verdict.sample_count).toBe(25);
  });

  it("day 7 + 5 trials → running (sample floor not met)", () => {
    const trials = makeTrials(5, true, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_7_DAYS_AGO,
      now_iso: NOW,
      trials,
      main_pass_rate: 0.75,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    expect(verdict.status).toBe("running");
    expect(verdict.reason).toContain("sample_count");
  });
});

// ── AC-3: Sample floor + insufficient-traffic revert ─────────────────────────

describe("evaluateSoak — insufficient-traffic revert (AC-3)", () => {
  const NOW = "2026-07-29T12:00:00.000Z";
  const STARTED_21_DAYS_AGO = daysAgo(21, NOW);
  const STARTED_14_DAYS_AGO = daysAgo(14, NOW);

  it("day 14 + 8 trials → running (maxSoakDays not reached)", () => {
    const trials = makeTrials(8, true, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_14_DAYS_AGO,
      now_iso: NOW,
      trials,
      main_pass_rate: 0.75,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    expect(verdict.status).toBe("running");
  });

  it("day 21 + 10 trials → reverted (maxSoakDays reached, sample_count < minSoakTrials)", () => {
    const trials = makeTrials(10, true, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_21_DAYS_AGO,
      now_iso: NOW,
      trials,
      main_pass_rate: 0.75,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    expect(verdict.status).toBe("reverted");
    expect(verdict.reason).toContain("soak_insufficient_traffic");
    expect(verdict.sample_count).toBe(10);
  });

  it("day 21 + 20 trials → passed (exactly meets sample floor at maxSoakDays)", () => {
    const trials = makeTrials(20, true, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_21_DAYS_AGO,
      now_iso: NOW,
      trials,
      main_pass_rate: 0.75,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    // Both clocks met (21 >= 7 AND 20 >= 20); no early-revert trigger (1.0 >> 0.75)
    expect(verdict.status).toBe("passed");
  });
});

// ── AC-4: Early-revert on rolling window regression ───────────────────────────

describe("evaluateSoak — early-revert (AC-4)", () => {
  const NOW = "2026-07-03T12:00:00.000Z";
  const STARTED_2_DAYS_AGO = daysAgo(2, NOW);

  it("soak_pass_rate 0.50 vs main_pass_rate 0.80 → failed (30pp regression)", () => {
    // 10 passing + 10 failing in the rolling window
    const passingTrials = makeTrials(10, true, NOW);
    const failingTrials = makeTrials(10, false, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_2_DAYS_AGO,
      now_iso: NOW,
      trials: [...passingTrials, ...failingTrials],
      main_pass_rate: 0.8,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    expect(verdict.status).toBe("failed");
    expect(verdict.soak_pass_rate).toBeCloseTo(0.5, 2);
    expect(verdict.pass_rate_delta).toBeCloseTo(-0.3, 2);
    expect(verdict.reason).toContain("early-revert");
  });

  it("soak_pass_rate 0.79 vs main_pass_rate 0.80 (1pp) — within epsilon → running", () => {
    // 79 passing + 21 failing → 0.79 pass rate
    const passingTrials = makeTrials(79, true, NOW);
    const failingTrials = makeTrials(21, false, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_2_DAYS_AGO,
      now_iso: NOW,
      trials: [...passingTrials, ...failingTrials],
      main_pass_rate: 0.8,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    // 0.79 < 0.80 − 0.02=0.78? No: 0.79 >= 0.78, so no early-revert
    expect(verdict.status).toBe("running");
  });

  it("soak_pass_rate 0.77 vs main_pass_rate 0.80 (3pp) — beyond epsilon → failed", () => {
    // 77 passing + 23 failing → 0.77 pass rate
    const passingTrials = makeTrials(77, true, NOW);
    const failingTrials = makeTrials(23, false, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_2_DAYS_AGO,
      now_iso: NOW,
      trials: [...passingTrials, ...failingTrials],
      main_pass_rate: 0.8,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    // 0.77 < 0.80 − 0.02=0.78 → early-revert
    expect(verdict.status).toBe("failed");
  });
});

// ── Rolling window excludes old trials ────────────────────────────────────────

describe("evaluateSoak — rolling window excludes stale trials", () => {
  const NOW = "2026-07-10T12:00:00.000Z";
  // Trials created 2 days ago are OUTSIDE the 1-day window
  const TWO_DAYS_AGO = daysAgo(2, NOW);
  const STARTED_2_DAYS_AGO = daysAgo(2, NOW);

  it("old failing trials excluded; only recent passing trials counted → no early-revert", () => {
    // 20 failing trials from 2 days ago — outside the rolling window
    const oldFailing = makeTrials(20, false, TWO_DAYS_AGO);
    // 20 passing trials from now — inside the rolling window
    const recentPassing = makeTrials(20, true, NOW);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_2_DAYS_AGO,
      now_iso: NOW,
      trials: [...oldFailing, ...recentPassing],
      main_pass_rate: 0.8,
    };
    // Rolling window only sees 20 passing → soak_pass_rate = 1.0
    const verdict = evaluateSoak(state, BASE_POLICY);
    // elapsed 2 days < 7 days → running (not passed/failed)
    expect(verdict.status).toBe("running");
    expect(verdict.soak_pass_rate).toBeCloseTo(1.0, 2);
  });

  it("rolling window empty → pass rate defaults to 1.0 (no revert)", () => {
    // All trials from 2 days ago (outside window)
    const oldTrials = makeTrials(5, false, TWO_DAYS_AGO);
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_2_DAYS_AGO,
      now_iso: NOW,
      trials: oldTrials,
      main_pass_rate: 0.8,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    // Empty window → pass rate 1.0 → no early-revert
    expect(verdict.soak_pass_rate).toBe(1.0);
    expect(verdict.status).not.toBe("failed");
  });
});

// ── Priority ordering: early-revert beats insufficient-traffic ────────────────

describe("evaluateSoak — priority: early-revert beats maxSoakDays revert", () => {
  const NOW = "2026-07-29T12:00:00.000Z";
  const STARTED_21_DAYS_AGO = daysAgo(21, NOW);

  it("maxSoakDays reached AND pass rate regressed → failed (early-revert wins)", () => {
    // 5 passing + 5 failing → 0.50 pass rate
    const trials = [...makeTrials(5, true, NOW), ...makeTrials(5, false, NOW)];
    const state: SoakState = {
      agent: "fullstack-dev",
      started_at: STARTED_21_DAYS_AGO,
      now_iso: NOW,
      trials,
      main_pass_rate: 0.8,
    };
    const verdict = evaluateSoak(state, BASE_POLICY);
    // early-revert fires before insufficient-traffic check
    expect(verdict.status).toBe("failed");
    expect(verdict.reason).toContain("early-revert");
  });
});

// ── SOAK_ROLLING_WINDOW_MS export ─────────────────────────────────────────────

it("SOAK_ROLLING_WINDOW_MS is exactly 24 hours in milliseconds", () => {
  expect(SOAK_ROLLING_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
});
