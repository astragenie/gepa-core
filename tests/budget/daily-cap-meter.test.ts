import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dailyCapMeter } from "../../src/budget/daily-cap-meter.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gepa-meter-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("dailyCapMeter", () => {
  test("reserve under cap returns ok", async () => {
    const meter = dailyCapMeter(10, join(root, "meter.json"));
    const r = await meter.reserve(1);
    expect(r.ok).toBe(true);
    expect(r.remainingUsd).toBeCloseTo(9);
  });

  test("reserve over cap returns ok:false", async () => {
    const meter = dailyCapMeter(10, join(root, "meter.json"));
    await meter.reserve(8);
    const r = await meter.reserve(5);
    expect(r.ok).toBe(false);
  });

  test("record adjusts remainder using actual cost", async () => {
    const meter = dailyCapMeter(10, join(root, "meter.json"));
    const r = await meter.reserve(2);
    await meter.record(r.reservationId, 1.5); // actual < reservation
    expect(await meter.spentToday()).toBeCloseTo(1.5);
  });

  test("release frees reserved amount", async () => {
    const meter = dailyCapMeter(10, join(root, "meter.json"));
    const r = await meter.reserve(3);
    await meter.release(r.reservationId);
    const remaining = await meter.reserve(8);
    expect(remaining.ok).toBe(true);
  });

  test("orphan reservation expires at TTL", async () => {
    const meter = dailyCapMeter(10, join(root, "meter.json"));
    await meter.reserve(3, { ttlSeconds: 0 }); // immediate expiry
    // Simulate process restart by constructing a new meter on the same path.
    const meter2 = dailyCapMeter(10, join(root, "meter.json"));
    // Force expiry sweep.
    await meter2.spentToday();
    const r = await meter2.reserve(8);
    expect(r.ok).toBe(true);
  });
});
