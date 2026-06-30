/**
 * detectEvalDrift — compare train vs held-out pass rates on a trial corpus.
 *
 * SLICE-100 (FEAT-183 S5a). Surfaces when the held-out split's pass-rate
 * diverges from the train split's by more than the configured threshold —
 * a sign that the optimizer is overfitting to the train cases. Default
 * threshold (0.10 = 10 pp) is intentionally generous; calibration is
 * deferred to SLICE-104 with real soak data.
 *
 * Inputs:
 *   - trials: full corpus (both splits present, each trial's EvalCase has
 *     a `held_out: boolean` flag — but the trial schema doesn't carry the
 *     flag, so callers pass two arrays instead via `splitTrials`).
 *   - Use `detectEvalDriftFromSplits` when caller already has the split.
 *   - Use `detectEvalDrift` when caller has only a pass-rate for held-out
 *     (e.g. live held-out evaluation runs separately).
 */

import type { Trial } from "../types/trial.ts";

export interface DriftReport {
  /** True when |trainPassRate - heldOutPassRate| > threshold. */
  drift: boolean;
  /** Signed delta in PERCENTAGE POINTS (heldOut - train). Positive means held-out is better. */
  deltaPp: number;
  /** Pass rate computed across train trials, 0..1. */
  trainPassRate: number;
  /** Pass rate computed across held-out trials, 0..1. (Or the value passed in if using
   * the simple `detectEvalDrift(trials, heldOutPass)` signature.) */
  heldOutPassRate: number;
  /** Count of trials in each split. */
  trainCount: number;
  heldOutCount: number;
  /** Effective threshold used for the drift decision (defaults to 0.10). */
  threshold: number;
}

export interface DetectDriftOpts {
  /** Drift threshold in absolute fraction (e.g. 0.10 = 10 percentage points). Default 0.10. */
  threshold?: number;
  /** Minimum trial count per split below which `drift` is forced to `false` (insufficient
   * sample). Default: 5. */
  minSampleSize?: number;
}

/**
 * Detect drift when caller supplies a held-out pass-rate directly (e.g. measured by
 * an external held-out evaluation step). `trials` here is treated as the train split.
 */
export function detectEvalDrift(
  trials: Trial[],
  heldOutPassRate: number,
  opts: DetectDriftOpts = {},
): DriftReport {
  const threshold = opts.threshold ?? 0.1;
  const minSampleSize = opts.minSampleSize ?? 5;
  const trainPassRate = passRate(trials);
  const trainCount = trials.length;
  const heldOutCount = Number.NaN; // unknown — caller passed only the rate
  const deltaPp = heldOutPassRate - trainPassRate;
  const drift = trainCount >= minSampleSize && Math.abs(deltaPp) > threshold;
  return {
    drift,
    deltaPp,
    trainPassRate,
    heldOutPassRate,
    trainCount,
    heldOutCount,
    threshold,
  };
}

/**
 * Detect drift when caller supplies both splits as arrays.
 */
export function detectEvalDriftFromSplits(
  train: Trial[],
  heldOut: Trial[],
  opts: DetectDriftOpts = {},
): DriftReport {
  const threshold = opts.threshold ?? 0.1;
  const minSampleSize = opts.minSampleSize ?? 5;
  const trainPassRate = passRate(train);
  const heldOutPassRate = passRate(heldOut);
  const deltaPp = heldOutPassRate - trainPassRate;
  const drift =
    train.length >= minSampleSize &&
    heldOut.length >= minSampleSize &&
    Math.abs(deltaPp) > threshold;
  return {
    drift,
    deltaPp,
    trainPassRate,
    heldOutPassRate,
    trainCount: train.length,
    heldOutCount: heldOut.length,
    threshold,
  };
}

function passRate(trials: Trial[]): number {
  if (trials.length === 0) return 0;
  const passes = trials.reduce((sum, t) => sum + (t.score.pass ? 1 : 0), 0);
  return passes / trials.length;
}
