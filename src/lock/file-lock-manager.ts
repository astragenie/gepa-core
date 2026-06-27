import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { LockManager } from "../interfaces.ts";

/** A stale heartbeat older than this is treated as dead. */
const HEARTBEAT_STALE_MS = 60_000;

const LockPayloadSchema = z.object({
  pid: z.number().int().positive(),
  op: z.enum(["eval", "optimize"]),
  agent: z.string(),
  heartbeat: z.number().nonnegative(),
});

type LockPayload = z.infer<typeof LockPayloadSchema>;

function lockPath(locksDir: string, agent: string, op: string): string {
  // Sanitize agent name to be filesystem-safe
  const safeAgent = agent.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(locksDir, `${safeAgent}__${op}.lock`);
}

/** Returns true if the PID is live (process exists). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH = no such process; EPERM = exists but no permission (still alive)
    // On Windows process.kill throws if process doesn't exist
    return false;
  }
}

/**
 * Reads an existing lock file and determines if it is stale.
 * A lock is stale when:
 *  - its PID is dead (process.kill(pid, 0) throws ESRCH), OR
 *  - its heartbeat is older than HEARTBEAT_STALE_MS
 */
function isLockStale(payload: LockPayload): boolean {
  const heartbeatAge = Date.now() - payload.heartbeat;
  if (heartbeatAge > HEARTBEAT_STALE_MS) return true;
  if (!isPidAlive(payload.pid)) return true;
  return false;
}

/**
 * Attempts an atomic write using the `wx` flag (fail-if-exists).
 * Returns true if the write succeeded (we own the lock), false if the file
 * already exists (someone else holds it).
 */
function tryAtomicWrite(path: string, payload: LockPayload): boolean {
  try {
    writeFileSync(path, JSON.stringify(payload), { flag: "wx" });
    return true;
  } catch (err: unknown) {
    // EEXIST means the file already exists
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw err;
  }
}

/**
 * `fileLockManager(locksDir)` — file-backed `LockManager`.
 *
 * Each lock is a JSON file at `<locksDir>/<agent>__<op>.lock` containing
 * `{ pid, op, agent, heartbeat }`. Atomicity is provided by the `wx` open
 * flag. Stale locks (dead PID OR heartbeat older than 60 s) are reclaimed
 * before a new acquire attempt.
 *
 * A background `setInterval` at 30 s refreshes the heartbeat while the lock
 * is held. The interval is `unref()`-ed so it does not keep the process alive.
 */
export function fileLockManager(locksDir: string): LockManager {
  // Ensure the directory exists before any operations.
  if (!existsSync(locksDir)) {
    mkdirSync(locksDir, { recursive: true });
  }

  return {
    async acquire(
      agent: string,
      op: "eval" | "optimize",
    ): Promise<{ released: () => Promise<void> } | null> {
      const path = lockPath(locksDir, agent, op);

      // If a lock file exists, check if it is stale.
      if (existsSync(path)) {
        let payload: LockPayload | null = null;
        try {
          const parsed = LockPayloadSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
          if (parsed.success) {
            payload = parsed.data;
          } else {
            // Invalid schema — treat as stale, remove it.
            rmSync(path, { force: true });
          }
        } catch {
          // Corrupted lock file — treat as stale, remove it.
          rmSync(path, { force: true });
        }
        if (payload !== null) {
          if (isLockStale(payload)) {
            // Reclaim: remove the stale file so the atomic write below can proceed.
            rmSync(path, { force: true });
          } else {
            // Active lock held by another process — cannot acquire.
            return null;
          }
        }
      }

      // Attempt atomic write.
      const now = Date.now();
      const payload: LockPayload = {
        pid: process.pid,
        op,
        agent,
        heartbeat: now,
      };

      const acquired = tryAtomicWrite(path, payload);
      if (!acquired) {
        // Race — another process won the atomic write.
        return null;
      }

      // Heartbeat refresh every 30 s (half of HEARTBEAT_STALE_MS).
      const heartbeatInterval = setInterval(() => {
        if (!existsSync(path)) {
          clearInterval(heartbeatInterval);
          return;
        }
        try {
          const updated: LockPayload = { ...payload, heartbeat: Date.now() };
          // Overwrite (not wx) — we already own the file.
          writeFileSync(path, JSON.stringify(updated));
        } catch {
          // File removed externally — stop the interval.
          clearInterval(heartbeatInterval);
        }
      }, 30_000);

      // Unref so the interval does not keep the process alive if nothing else is running.
      heartbeatInterval.unref();

      return {
        released: async (): Promise<void> => {
          clearInterval(heartbeatInterval);
          rmSync(path, { force: true });
        },
      };
    },

    async isLocked(agent: string): Promise<boolean> {
      // Check any op (eval or optimize) — agent is locked if either file exists
      // and is not stale.
      for (const op of ["eval", "optimize"] as const) {
        const path = lockPath(locksDir, agent, op);
        if (!existsSync(path)) continue;
        let payload: LockPayload | null = null;
        try {
          const parsed = LockPayloadSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
          if (parsed.success) {
            payload = parsed.data;
          } else {
            continue; // Invalid schema — ignore.
          }
        } catch {
          continue; // Corrupted — ignore.
        }
        if (!isLockStale(payload)) return true;
      }
      return false;
    },
  };
}
