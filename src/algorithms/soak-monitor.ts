/**
 * soak-monitor.ts — dual-clock + sample-floor + rolling-window soak monitor.
 *
 * Implements the soak phase mechanics from the FEAT-183 design spec
 * (lines 631–652):
 *
 *   "promote" requires BOTH clocks to clear:
 *     elapsed_days >= soakDays  AND  soak_trials_count >= minSoakTrials
 *
 *   Early-revert fires any day when:
 *     soak_pass_rate < main_pass_rate - soakEpsilon  (rolling 1-day window)
 *
 *   Insufficient-traffic revert fires when:
 *     elapsed_days >= maxSoakDays  AND  soak_trials_count < minSoakTrials
 *
 * Resolved concerns:
 *   C13 — dual-clock (wall time + sample count) prevents premature promotion
 *          on low-traffic agents (spec line 70).
 *   C20 — soak trials scored by the configured rubricScorer; SoakTrial carries
 *          pass + score + source: "soak" for auditability (spec line 77).
 *
 * IMPORTANT: This module is pure computation — it does NOT do I/O. The caller
 * (crew-side soak-dispatcher-hook.ts) owns reading soak.json, appending trials,
 * writing the forensics artifact, and emitting events to events.jsonl.
 *
 * All timestamps flow in via SoakState.now_iso (injectable for deterministic
 * testing; no Date.now() calls in algorithm code).
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Minimal trial record needed by the soak monitor.
 * Maps to Trial.score.pass / Trial.score.score / Trial.created_at.
 */
export interface SoakTrial {
  /** ISO datetime the trial was created — used to determine the rolling window. */
  created_at: string;
  /** Whether the candidate passed the rubric for this dispatch. */
  pass: boolean;
  /** Continuous score 0..1. */
  score: number;
  /** Always "soak" for trials in this context. */
  source: "soak";
}

/**
 * State snapshot for a single agent's active soak.
 * Loaded from soak.json by the caller.
 */
export interface SoakState {
  /** Agent name — used for logging only; not checked by this module. */
  agent: string;
  /**
   * ISO datetime the soak started. Used with now_iso to compute elapsed_days.
   */
  started_at: string;
  /**
   * Caller-injected "now" in ISO format.
   * Injected rather than read from Date.now() so tests can advance virtual time.
   */
  now_iso: string;
  /** All soak trials collected so far (ordered by created_at asc). */
  trials: SoakTrial[];
  /**
   * Pass rate of the main champion in the rolling 1-day window, computed by the
   * caller from recent captured/eval trials for the same agent.
   * Used in early-revert comparison.
   */
  main_pass_rate: number;
}

/**
 * Policy values consumed by the soak monitor.
 * Matches PromotionPolicy fields (imported by reference, not by value, to avoid
 * circular deps — the caller passes the relevant sub-object).
 */
export interface SoakPolicy {
  soakDays: number; // target clock duration
  minSoakTrials: number; // sample-floor
  maxSoakDays: number; // hard cap: revert with insufficient-traffic if under floor
  soakEpsilon: number; // tolerance on pass_rate comparison
}

/**
 * Result of a single evaluate() call.
 */
export type SoakVerdictStatus =
  | "running" // dual-clock not yet met; no revert trigger
  | "passed" // both clocks met; no early-revert or insufficient-traffic trigger
  | "failed" // early-revert: soak_pass_rate dropped below main_pass_rate − ε
  | "reverted"; // maxSoakDays reached with insufficient trials

export interface SoakVerdict {
  status: SoakVerdictStatus;
  /** Wall-clock days since soak started (may be fractional). */
  elapsed_days: number;
  /** Total soak trials collected so far. */
  sample_count: number;
  /** Human-readable description for logs and forensics. */
  reason: string;
  /**
   * Pass rate in the rolling 1-day window (for the soak candidate).
   * Set even on non-revert verdicts so callers can track drift over time.
   */
  soak_pass_rate: number;
  /**
   * Delta = soak_pass_rate − main_pass_rate. Negative means candidate regressed.
   * Included in forensics artifact on early-revert.
   */
  pass_rate_delta: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

function elapsedDays(startedAt: string, nowIso: string): number {
  const diffMs = isoToMs(nowIso) - isoToMs(startedAt);
  return diffMs / (1000 * 60 * 60 * 24);
}

/**
 * Compute pass rate for trials within the most recent windowMs milliseconds
 * relative to nowIso. Returns 1.0 if there are no trials in the window (no
 * data → assume OK; caller should check sample_count separately).
 */
function rollingPassRate(trials: SoakTrial[], nowIso: string, windowMs: number): number {
  const cutoff = isoToMs(nowIso) - windowMs;
  const inWindow = trials.filter((t) => isoToMs(t.created_at) >= cutoff);
  if (inWindow.length === 0) return 1.0;
  const passed = inWindow.filter((t) => t.pass).length;
  return passed / inWindow.length;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Rolling window duration — design spec uses 1 day. */
export const SOAK_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Evaluate the current soak state and return a verdict.
 *
 * Decision tree (applied in order — first match wins):
 *   1. EARLY-REVERT:   soak_pass_rate < main_pass_rate − epsilon → "failed"
 *   2. INSUFF-TRAFFIC: elapsed_days >= maxSoakDays AND sample_count < minSoakTrials → "reverted"
 *   3. PROMOTE:        elapsed_days >= soakDays AND sample_count >= minSoakTrials → "passed"
 *   4. RUNNING:        all other cases → "running"
 */
export function evaluateSoak(state: SoakState, policy: SoakPolicy): SoakVerdict {
  const elapsed = elapsedDays(state.started_at, state.now_iso);
  const sampleCount = state.trials.length;

  const soakPassRate = rollingPassRate(state.trials, state.now_iso, SOAK_ROLLING_WINDOW_MS);
  const delta = soakPassRate - state.main_pass_rate;

  // 1. Early-revert: rolling pass rate dropped too far below main
  if (soakPassRate < state.main_pass_rate - policy.soakEpsilon) {
    return {
      status: "failed",
      elapsed_days: elapsed,
      sample_count: sampleCount,
      soak_pass_rate: soakPassRate,
      pass_rate_delta: delta,
      reason: `soak_pass_rate ${soakPassRate.toFixed(3)} < main_pass_rate ${state.main_pass_rate.toFixed(3)} - epsilon ${policy.soakEpsilon} — early-revert triggered`,
    };
  }

  // 2. Insufficient-traffic revert: hard cap reached with too few trials
  if (elapsed >= policy.maxSoakDays && sampleCount < policy.minSoakTrials) {
    return {
      status: "reverted",
      elapsed_days: elapsed,
      sample_count: sampleCount,
      soak_pass_rate: soakPassRate,
      pass_rate_delta: delta,
      reason: `maxSoakDays (${policy.maxSoakDays}) reached with soak_trials_count ${sampleCount} < minSoakTrials ${policy.minSoakTrials} — soak_insufficient_traffic`,
    };
  }

  // 3. Promote: both dual-clock gates met, no revert
  if (elapsed >= policy.soakDays && sampleCount >= policy.minSoakTrials) {
    return {
      status: "passed",
      elapsed_days: elapsed,
      sample_count: sampleCount,
      soak_pass_rate: soakPassRate,
      pass_rate_delta: delta,
      reason: `soak passed — elapsed_days ${elapsed.toFixed(2)} >= ${policy.soakDays} AND sample_count ${sampleCount} >= ${policy.minSoakTrials}`,
    };
  }

  // 4. Still running
  const reasons: string[] = [];
  if (elapsed < policy.soakDays) {
    reasons.push(`elapsed_days ${elapsed.toFixed(2)} < soakDays ${policy.soakDays}`);
  }
  if (sampleCount < policy.minSoakTrials) {
    reasons.push(`sample_count ${sampleCount} < minSoakTrials ${policy.minSoakTrials}`);
  }

  return {
    status: "running",
    elapsed_days: elapsed,
    sample_count: sampleCount,
    soak_pass_rate: soakPassRate,
    pass_rate_delta: delta,
    reason: `running — ${reasons.join("; ")}`,
  };
}
