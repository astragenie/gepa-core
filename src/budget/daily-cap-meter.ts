import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { BudgetMeter } from "../interfaces.ts";

const StateSchema = z.object({
  day: z.string(),
  spent: z.number().nonnegative(),
  reservations: z.array(
    z.object({
      id: z.string(),
      amount: z.number().nonnegative(),
      expiresAt: z.number(),
    }),
  ),
});

type State = z.infer<typeof StateSchema>;
type Reservation = State["reservations"][number];

const DEFAULT_TTL_S = 600;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(path: string): State {
  if (!existsSync(path)) return { day: todayIso(), spent: 0, reservations: [] };
  try {
    const parsed = StateSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return { day: todayIso(), spent: 0, reservations: [] };
    const s = parsed.data;
    // Day-roll-over: if the persisted day is not today, reset.
    if (s.day !== todayIso()) return { day: todayIso(), spent: 0, reservations: [] };
    return s;
  } catch {
    return { day: todayIso(), spent: 0, reservations: [] };
  }
}

function save(path: string, state: State): void {
  writeFileSync(path, JSON.stringify(state));
}

function pruneExpired(state: State): State {
  const now = Date.now();
  state.reservations = state.reservations.filter((r) => r.expiresAt > now);
  return state;
}

/**
 * dailyCapMeter — file-backed BudgetMeter with reservation TTL.
 *
 * Reservations are persisted to `persistPath` so orphan recovery and
 * day-roll-over both survive a process restart. A reservation with
 * ttlSeconds=0 expires immediately, making it safe to test expiry without
 * real-time sleeps.
 */
export function dailyCapMeter(capUsd: number, persistPath: string): BudgetMeter {
  return {
    async reserve(estimateUsd, opts) {
      const state = pruneExpired(load(persistPath));
      const held = state.reservations.reduce((sum, r) => sum + r.amount, 0);
      const projected = state.spent + held + estimateUsd;
      if (projected > capUsd) {
        save(persistPath, state);
        return {
          reservationId: crypto.randomUUID(),
          ok: false,
          remainingUsd: Math.max(0, capUsd - state.spent - held),
        };
      }
      const ttlMs = (opts?.ttlSeconds ?? DEFAULT_TTL_S) * 1000;
      const reservation: Reservation = {
        id: crypto.randomUUID(),
        amount: estimateUsd,
        expiresAt: Date.now() + ttlMs,
      };
      state.reservations.push(reservation);
      save(persistPath, state);
      return {
        reservationId: reservation.id,
        ok: true,
        remainingUsd: capUsd - state.spent - held - estimateUsd,
      };
    },

    async record(reservationId, cost) {
      const state = pruneExpired(load(persistPath));
      state.reservations = state.reservations.filter((r) => r.id !== reservationId);
      // FEAT-186 S2: accept both `number` (0.3.x callers) and JudgeCost (0.4.0+).
      // Only `usd` is consumed for accumulator math today; richer fields (tokens, cache)
      // are intentionally ignored at record-time — observability extensions read them later.
      const actualUsd = typeof cost === "number" ? cost : cost.usd;
      state.spent += actualUsd;
      save(persistPath, state);
    },

    async release(reservationId) {
      const state = pruneExpired(load(persistPath));
      state.reservations = state.reservations.filter((r) => r.id !== reservationId);
      save(persistPath, state);
    },

    async spentToday() {
      const state = pruneExpired(load(persistPath));
      // Persist the pruned state so expired reservations are flushed on disk too.
      save(persistPath, state);
      return state.spent;
    },

    dailyCap() {
      return capUsd;
    },
  };
}
