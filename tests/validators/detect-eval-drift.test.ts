/**
 * tests/validators/detect-eval-drift.test.ts
 *
 * SLICE-100 AC-8: drift detection between train and held-out splits.
 */

import { describe, expect, test } from "bun:test";
import type { Trial } from "../../src/types/trial.ts";
import {
  detectEvalDrift,
  detectEvalDriftFromSplits,
} from "../../src/validators/detect-eval-drift.ts";

function mkTrial(pass: boolean, agent = "fullstack-dev"): Trial {
  return {
    id: crypto.randomUUID(),
    agent,
    phase: "build",
    candidate_prompt_hash: "abc",
    candidate_prompt_path: "agents/fullstack-dev.md",
    input: null,
    output: "...",
    score: {
      pass,
      score: pass ? 0.9 : 0.2,
      cost_usd: 0.01,
      latency_ms: 100,
    },
    source: "eval",
    pareto_rank: null,
    created_at: new Date().toISOString(),
  };
}

function trials(passes: number, total: number): Trial[] {
  return Array.from({ length: total }, (_, i) => mkTrial(i < passes));
}

describe("SLICE-100 AC-8 — detectEvalDrift (held-out pass rate given)", () => {
  test("35pp delta with default threshold 0.10 → drift=true", () => {
    const train = trials(48, 80); // 60% pass
    const report = detectEvalDrift(train, 0.95);
    expect(report.drift).toBe(true);
    expect(report.deltaPp).toBeCloseTo(0.35, 5);
    expect(report.trainPassRate).toBeCloseTo(0.6, 5);
    expect(report.heldOutPassRate).toBe(0.95);
    expect(report.threshold).toBe(0.1);
  });

  test("5pp delta with default threshold 0.10 → drift=false", () => {
    const train = trials(72, 80); // 90% pass
    const report = detectEvalDrift(train, 0.95);
    expect(report.drift).toBe(false);
    expect(report.deltaPp).toBeCloseTo(0.05, 5);
  });

  test("delta just below threshold (9pp < 10pp) → drift=false", () => {
    const train = trials(56, 80); // 70% pass
    const report = detectEvalDrift(train, 0.79); // 9pp delta — clearly under
    expect(report.drift).toBe(false);
    expect(report.deltaPp).toBeCloseTo(0.09, 5);
  });

  test("custom threshold 0.05 catches 6pp delta as drift", () => {
    const train = trials(72, 80); // 90% pass
    const report = detectEvalDrift(train, 0.96, { threshold: 0.05 });
    expect(report.drift).toBe(true);
    expect(report.threshold).toBe(0.05);
  });

  test("insufficient train sample (< minSampleSize) → drift forced false", () => {
    const train = trials(2, 3); // only 3 trials
    const report = detectEvalDrift(train, 0.0); // huge delta on paper
    expect(report.drift).toBe(false);
    expect(report.trainCount).toBe(3);
  });

  test("custom minSampleSize=2 lets a tiny train sample fire", () => {
    const train = trials(2, 3);
    const report = detectEvalDrift(train, 0.0, { minSampleSize: 2 });
    expect(report.drift).toBe(true);
  });
});

describe("SLICE-100 AC-8 — detectEvalDriftFromSplits (both arrays given)", () => {
  test("equivalent split-based call yields same drift verdict", () => {
    const train = trials(48, 80); // 60% pass
    const heldOut = trials(19, 20); // 95% pass
    const report = detectEvalDriftFromSplits(train, heldOut);
    expect(report.drift).toBe(true);
    expect(report.deltaPp).toBeCloseTo(0.35, 5);
    expect(report.trainCount).toBe(80);
    expect(report.heldOutCount).toBe(20);
  });

  test("equal splits → no drift", () => {
    const train = trials(40, 50);
    const heldOut = trials(8, 10);
    const report = detectEvalDriftFromSplits(train, heldOut);
    expect(report.drift).toBe(false);
    expect(report.deltaPp).toBeCloseTo(0, 5);
  });

  test("both splits below minSampleSize → drift false (insufficient data both sides)", () => {
    const train = trials(2, 3);
    const heldOut = trials(2, 3);
    const report = detectEvalDriftFromSplits(train, heldOut);
    expect(report.drift).toBe(false);
  });

  test("only one split below minSampleSize → drift false", () => {
    const train = trials(48, 80);
    const heldOut = trials(3, 3); // 100% pass but only 3
    const report = detectEvalDriftFromSplits(train, heldOut);
    expect(report.drift).toBe(false);
  });
});
