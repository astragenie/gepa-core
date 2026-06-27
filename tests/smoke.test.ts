import { describe, expect, test } from "bun:test";
import {
  binaryScorer,
  dailyCapMeter,
  dominates,
  fileLockManager,
  fileStore,
  paretoRank,
  sequentialRunner,
  validateCandidateSize,
} from "../src/index.ts";

describe("smoke — public API", () => {
  test("every public export is a function", () => {
    expect(typeof binaryScorer).toBe("function");
    expect(typeof dailyCapMeter).toBe("function");
    expect(typeof dominates).toBe("function");
    expect(typeof fileLockManager).toBe("function");
    expect(typeof fileStore).toBe("function");
    expect(typeof paretoRank).toBe("function");
    expect(typeof sequentialRunner).toBe("function");
    expect(typeof validateCandidateSize).toBe("function");
  });
});
