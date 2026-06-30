/**
 * tests/budget/daily-cap-cross-pipeline.test.ts
 *
 * FEAT-186 S2 — verifies `dailyCapMeter.record()` accepts the canonical
 * `JudgeCost` shape from both the evals pipeline and the gepa pipeline
 * AND enforces the daily cap across the union of those costs.
 *
 * Scenario (from FEAT-186 S2 backlog scope):
 *   - Configure $1/day cap.
 *   - Pipeline A (evals/cli.ts simulation) spends $0.60.
 *   - Pipeline B (gepa Trial simulation) spends $0.50.
 *   - Third call attempts $0.10 → blocked because $0.60 + $0.50 + $0.10 > $1.00.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dailyCapMeter } from "../../src/budget/daily-cap-meter.ts";
import { type JudgeCost, toJudgeCost } from "../../src/types/cost.ts";

function tmp(): string {
  return join(mkdtempSync(join(tmpdir(), "gepa-meter-xpipeline-")), "meter.json");
}

describe("FEAT-186 S2 — dailyCapMeter cross-pipeline ingestion", () => {
  test("accepts JudgeCost shape via record() (gepa-pipeline call pattern)", async () => {
    const meter = dailyCapMeter(1.0, tmp());

    const reservation = await meter.reserve(0.6);
    expect(reservation.ok).toBe(true);

    const cost: JudgeCost = {
      usd: 0.6,
      latency_ms: 432,
      tokens: { in: 1200, out: 380 },
    };
    await meter.record(reservation.reservationId, cost);

    expect(await meter.spentToday()).toBeCloseTo(0.6, 5);
  });

  test("accepts plain number via record() (0.3.x backward-compat call pattern)", async () => {
    const meter = dailyCapMeter(1.0, tmp());

    const reservation = await meter.reserve(0.6);
    expect(reservation.ok).toBe(true);

    await meter.record(reservation.reservationId, 0.6);

    expect(await meter.spentToday()).toBeCloseTo(0.6, 5);
  });

  test("daily cap enforced across mixed-shape records (pipeline A JudgeCost + pipeline B number + 3rd blocked)", async () => {
    const meter = dailyCapMeter(1.0, tmp());

    // Pipeline A (evals): $0.60 via JudgeCost shape — reserve + record.
    const rA = await meter.reserve(0.6);
    expect(rA.ok).toBe(true);
    await meter.record(rA.reservationId, {
      usd: 0.6,
      latency_ms: 432,
      tokens: { in: 1200, out: 380 },
    });

    // Pipeline B (gepa): $0.30 via plain number (0.3.x backward-compat call pattern).
    // $0.60 spent + $0.30 reserved = $0.90 — fits under $1.00 cap.
    const rB = await meter.reserve(0.3);
    expect(rB.ok).toBe(true);
    await meter.record(rB.reservationId, 0.3);

    // Cumulative spend = $0.90 — meter has $0.10 remaining.
    expect(await meter.spentToday()).toBeCloseTo(0.9, 5);

    // Third call for $0.20 must fail to reserve — cap exceeded (would project $1.10 > $1.00).
    const rC = await meter.reserve(0.2);
    expect(rC.ok).toBe(false);
    expect(rC.remainingUsd).toBeCloseTo(0.1, 5);
  });

  test("toJudgeCost extracts canonical shape from LLMJudge.evaluate() result", () => {
    const evaluateResult = {
      pass: true,
      score: 0.92,
      rubricScores: { clarity: 0.9, correctness: 0.94 },
      rationale: "Both criteria met.",
      cost_usd: 0.018,
      latency_ms: 612,
      tokens: { in: 1500, out: 420 },
      raw: { some: "provider response" },
    };
    const cost = toJudgeCost(evaluateResult);
    expect(cost).toEqual({
      usd: 0.018,
      latency_ms: 612,
      tokens: { in: 1500, out: 420 },
    });
  });

  test("toJudgeCost preserves optional cache field when present", () => {
    const evaluateResult = {
      pass: true,
      score: 0.85,
      rubricScores: { clarity: 0.85 },
      rationale: "Clear enough.",
      cost_usd: 0.004,
      latency_ms: 91,
      cache: { hit: true, tokens_saved: 880 },
    };
    const cost = toJudgeCost(evaluateResult);
    expect(cost.cache).toEqual({ hit: true, tokens_saved: 880 });
    expect(cost.tokens).toBeUndefined();
  });

  test("toJudgeCost result feeds straight into meter.record()", async () => {
    const meter = dailyCapMeter(1.0, tmp());

    const reservation = await meter.reserve(0.018);
    expect(reservation.ok).toBe(true);

    const evaluateResult = {
      pass: true,
      score: 0.9,
      rubricScores: { clarity: 0.9 },
      rationale: "ok",
      cost_usd: 0.018,
      latency_ms: 612,
      tokens: { in: 1500, out: 420 },
    };
    await meter.record(reservation.reservationId, toJudgeCost(evaluateResult));

    expect(await meter.spentToday()).toBeCloseTo(0.018, 5);
  });
});
