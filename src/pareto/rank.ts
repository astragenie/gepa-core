/**
 * Pareto ranking for GEPA trial candidates.
 *
 * Objectives (strict dominance):
 *   MAXIMIZE  score      (higher is better)
 *   MINIMIZE  cost_usd   (lower is better)
 *   MINIMIZE  latency_ms (lower is better)
 *   pass=true  strictly better than pass=false
 *
 * A trial dominates B when A is at least as good on ALL objectives
 * AND strictly better on at least ONE.
 *
 * paretoRank assigns integer ranks starting at 1:
 *   - Rank 1 = not dominated by any other trial.
 *   - Rank k = dominated only by rank-(k-1) or lower trials (iterative stripping).
 *
 * The returned array is sorted by tiebreaker within each rank tier:
 *   pass (true first) → score (desc) → cost_usd (asc) → latency_ms (asc) → id (asc)
 */

import type { ScoreResult } from "../types/score-result.ts";
import type { Trial } from "../types/trial.ts";

// ──────────────────────────────────────────────
// Tiebreaker type
// ──────────────────────────────────────────────

export type Tiebreaker = (
  a: ScoreResult & { id: string },
  b: ScoreResult & { id: string },
) => number;

// ──────────────────────────────────────────────
// RankedTrial
// ──────────────────────────────────────────────

export type RankedTrial = Trial & { pareto_rank: number };

// ──────────────────────────────────────────────
// dominates(a, b): true if a Pareto-dominates b
// ──────────────────────────────────────────────

/**
 * Pure dominance predicate. Exported for property tests.
 *
 * Returns true iff:
 *   a is at least as good as b on every objective
 *   AND strictly better on at least one.
 */
export function dominates(a: ScoreResult, b: ScoreResult): boolean {
  // Convert to "higher is better" form for all objectives.
  // pass: boolean → 1 (true) or 0 (false)
  const passA = a.pass ? 1 : 0;
  const passB = b.pass ? 1 : 0;

  // Cost and latency are minimized → negate for "higher is better"
  const atLeastAsGood =
    passA >= passB &&
    a.score >= b.score &&
    a.cost_usd <= b.cost_usd &&
    a.latency_ms <= b.latency_ms;

  if (!atLeastAsGood) return false;

  const strictlyBetter =
    passA > passB || a.score > b.score || a.cost_usd < b.cost_usd || a.latency_ms < b.latency_ms;

  return strictlyBetter;
}

// ──────────────────────────────────────────────
// Default tiebreaker
// ──────────────────────────────────────────────

const defaultTiebreaker: Tiebreaker = (a, b) => {
  // pass: true (1) before false (0) → descending
  const passA = a.pass ? 1 : 0;
  const passB = b.pass ? 1 : 0;
  if (passA !== passB) return passB - passA; // higher pass value first

  // score: descending
  if (a.score !== b.score) return b.score - a.score;

  // cost_usd: ascending
  if (a.cost_usd !== b.cost_usd) return a.cost_usd - b.cost_usd;

  // latency_ms: ascending
  if (a.latency_ms !== b.latency_ms) return a.latency_ms - b.latency_ms;

  // id: lexicographic ascending (full determinism)
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

// ──────────────────────────────────────────────
// paretoRank
// ──────────────────────────────────────────────

/**
 * Iteratively strips the non-dominated frontier to assign integer Pareto ranks.
 *
 * Algorithm:
 *   1. Find all trials not dominated by any remaining trial → rank k.
 *   2. Remove them from the working set.
 *   3. Repeat with k++ until the set is empty.
 *
 * Within each rank, trials are sorted by the tiebreaker (default or supplied).
 * The returned array preserves this sorted order across all ranks.
 *
 * @param trials    Input trials. Must have valid ScoreResult on `.score`.
 * @param tiebreaker Optional override for intra-rank ordering.
 */
export function paretoRank(trials: Trial[], tiebreaker?: Tiebreaker): RankedTrial[] {
  if (trials.length === 0) return [];

  const tb = tiebreaker ?? defaultTiebreaker;

  // Working set of indices into the original array
  let remaining = trials.map((_, i) => i);
  const result: RankedTrial[] = [];
  let rank = 1;

  while (remaining.length > 0) {
    // Find indices NOT dominated by any other remaining trial
    const frontier: number[] = [];

    for (const i of remaining) {
      const trialI = trials[i];
      if (trialI === undefined) continue;

      let isDominated = false;
      for (const j of remaining) {
        if (i === j) continue;
        const trialJ = trials[j];
        if (trialJ === undefined) continue;
        if (dominates(trialJ.score, trialI.score)) {
          isDominated = true;
          break;
        }
      }
      if (!isDominated) {
        frontier.push(i);
      }
    }

    // Sort the frontier by tiebreaker
    frontier.sort((i, j) => {
      const ti = trials[i];
      const tj = trials[j];
      if (ti === undefined || tj === undefined) return 0;
      return tb({ ...ti.score, id: ti.id }, { ...tj.score, id: tj.id });
    });

    // Assign rank and push to results
    for (const i of frontier) {
      const trial = trials[i];
      if (trial === undefined) continue;
      result.push({ ...trial, pareto_rank: rank });
    }

    // Strip frontier from remaining
    const frontierSet = new Set(frontier);
    remaining = remaining.filter((i) => !frontierSet.has(i));
    rank++;
  }

  return result;
}
