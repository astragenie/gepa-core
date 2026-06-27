import { describe, expect, test } from "bun:test";
import { describeBreakingChanges } from "../../scripts/check-semver.ts";

describe("describeBreakingChanges", () => {
  test("flags removed export as MAJOR-required", () => {
    const before = ["foo", "bar"];
    const after = ["foo"];
    const result = describeBreakingChanges(before, after);
    expect(result.requiresMajor).toBe(true);
    expect(result.removed).toContain("bar");
  });

  test("flags added export as MINOR-eligible", () => {
    const before = ["foo"];
    const after = ["foo", "bar"];
    const result = describeBreakingChanges(before, after);
    expect(result.requiresMajor).toBe(false);
    expect(result.added).toContain("bar");
  });

  test("no changes returns clean", () => {
    const result = describeBreakingChanges(["foo"], ["foo"]);
    expect(result.requiresMajor).toBe(false);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });
});
