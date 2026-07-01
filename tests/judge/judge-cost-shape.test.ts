/**
 * tests/judge/judge-cost-shape.test.ts
 *
 * FEAT-186 S1 contract test: assert `JudgeCost` is on the public export
 * surface of `@astragenie/gepa-core` and matches the canonical shape.
 *
 * Pure type / shape verification — no behavior under test. The point is to
 * lock the public contract so consumers (evals pipeline, dailyCapMeter S2,
 * cost report renderer S3) can rely on the shape being stable.
 *
 * Optionality contract verified: `tokens` and `cache` MUST stay optional
 * forever (S1 risk_notes). Providers without prompt-cache reporting or
 * without token counts cannot be forced to fabricate the fields.
 */

import { describe, expect, test } from "bun:test";
import type { JudgeCost } from "../../src/index.ts";

describe("FEAT-186 S1 — JudgeCost contract", () => {
  test("JudgeCost minimal — usd + latency_ms only (tokens + cache omitted)", () => {
    const cost: JudgeCost = {
      usd: 0.012,
      latency_ms: 487,
    };
    expect(cost.usd).toBe(0.012);
    expect(cost.latency_ms).toBe(487);
    expect(cost.tokens).toBeUndefined();
    expect(cost.cache).toBeUndefined();
  });

  test("JudgeCost with tokens (cache still optional)", () => {
    const cost: JudgeCost = {
      usd: 0.018,
      latency_ms: 623,
      tokens: { in: 1240, out: 380 },
    };
    expect(cost.tokens?.in).toBe(1240);
    expect(cost.tokens?.out).toBe(380);
    expect(cost.cache).toBeUndefined();
  });

  test("JudgeCost with cache hit (tokens_saved optional)", () => {
    const cost: JudgeCost = {
      usd: 0.004,
      latency_ms: 92,
      cache: { hit: true, tokens_saved: 880 },
    };
    expect(cost.cache?.hit).toBe(true);
    expect(cost.cache?.tokens_saved).toBe(880);
  });

  test("JudgeCost cache miss (tokens_saved omitted on miss)", () => {
    const cost: JudgeCost = {
      usd: 0.018,
      latency_ms: 623,
      cache: { hit: false },
    };
    expect(cost.cache?.hit).toBe(false);
    expect(cost.cache?.tokens_saved).toBeUndefined();
  });

  test("JudgeCost full shape — all optional fields populated", () => {
    const cost: JudgeCost = {
      usd: 0.022,
      latency_ms: 711,
      tokens: { in: 1500, out: 420 },
      cache: { hit: true, tokens_saved: 1100 },
    };
    expect(cost).toMatchObject({
      usd: 0.022,
      latency_ms: 711,
      tokens: { in: 1500, out: 420 },
      cache: { hit: true, tokens_saved: 1100 },
    });
  });

  test("type-level: JudgeCost is exported from package root", async () => {
    const mod = await import("../../src/index.ts");
    // Runtime check on the module — Type-only exports (`export type`) compile
    // away, so `mod.JudgeCost` will be undefined at runtime. The TypeScript
    // import above at the top of this file is the real contract assertion —
    // if `JudgeCost` is removed from the public surface, this file fails to
    // type-check and the test suite refuses to run.
    expect(typeof mod).toBe("object");
  });
});
