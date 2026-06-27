import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLockManager } from "../../src/lock/file-lock-manager.ts";

let locksDir: string;

beforeEach(() => {
  locksDir = mkdtempSync(join(tmpdir(), "gepa-locks-"));
});

afterEach(() => {
  rmSync(locksDir, { recursive: true, force: true });
});

describe("fileLockManager", () => {
  test("acquire-when-free: returns a release handle", async () => {
    const mgr = fileLockManager(locksDir);
    const lock = await mgr.acquire("fullstack-dev", "eval");
    expect(lock).not.toBeNull();
    // release should resolve cleanly
    await lock?.released();
  });

  test("acquire-when-held-returns-null: second acquire on same agent+op returns null", async () => {
    const mgr = fileLockManager(locksDir);
    const first = await mgr.acquire("fullstack-dev", "eval");
    expect(first).not.toBeNull();

    const second = await mgr.acquire("fullstack-dev", "eval");
    expect(second).toBeNull();

    await first?.released();
  });

  test("reclaim-stale-PID: lock file with dead PID is reclaimed and acquire succeeds", async () => {
    const mgr = fileLockManager(locksDir);

    // Write a stale lock file referencing a non-existent PID (999999)
    // with a heartbeat in the past (epoch 0 = definitely stale)
    const staleLock = {
      pid: 999999,
      op: "eval",
      agent: "fullstack-dev",
      heartbeat: 0, // epoch 0 = stale
    };
    writeFileSync(join(locksDir, "fullstack-dev__eval.lock"), JSON.stringify(staleLock));

    // Should reclaim the stale lock and succeed
    const lock = await mgr.acquire("fullstack-dev", "eval");
    expect(lock).not.toBeNull();
    await lock?.released();
  });

  test("isLocked-state: reflects acquired and released states correctly", async () => {
    const mgr = fileLockManager(locksDir);

    // Initially not locked
    const initialState = await mgr.isLocked("fullstack-dev");
    expect(initialState).toBe(false);

    // After acquire: locked
    const lock = await mgr.acquire("fullstack-dev", "eval");
    const heldState = await mgr.isLocked("fullstack-dev");
    expect(heldState).toBe(true);

    // After release: not locked
    await lock?.released();
    const releasedState = await mgr.isLocked("fullstack-dev");
    expect(releasedState).toBe(false);
  });
});
