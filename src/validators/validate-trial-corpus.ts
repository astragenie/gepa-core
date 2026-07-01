/**
 * validateTrialCorpus — scan a trial JSONL file for integrity issues.
 *
 * SLICE-100 (FEAT-183 S5a). Catches problems the file-store SIGKILL
 * invariant alone cannot — duplicate trial_ids, orphan agent refs,
 * trials missing required metrics fields. Designed to run as a periodic
 * audit or before a champion-promotion decision.
 *
 * Torn lines are detected separately because the store's `recall()`
 * silently discards them per the SIGKILL invariant (AC-6 here just
 * counts them so the audit surfaces the count even when recall hides
 * them from downstream consumers).
 */

import * as fs from "node:fs/promises";
import { TrialSchema } from "../types/trial.ts";

export interface ValidationReport {
  ok: boolean;
  tornLines: number;
  /** Trials whose `agent` field is not seen elsewhere in the corpus (defensive — catches
   * pipeline misconfig where a stale agent name slips through; not strictly an error). */
  orphanAgentRefs: number;
  /** Distinct trial_ids that appear in 2+ lines. */
  collisions: number;
  /** Trials missing required numeric fields (`score.cost_usd`, `score.latency_ms`). */
  missingMetrics: number;
  /** Distinct agent names referenced in the corpus. */
  agentsSeen: string[];
  /** trial_ids implicated in collisions (for caller reporting). */
  collidingTrialIds: string[];
  /** trial_ids missing metric fields (for caller reporting). */
  trialIdsMissingMetrics: string[];
}

export interface ValidateCorpusOpts {
  /**
   * Optional set of agent names known to be valid. When provided, any agent
   * appearing on a trial but NOT in this set counts as an orphanAgentRef.
   * When omitted, orphanAgentRefs counts agents that appear ONCE in the entire
   * corpus (heuristic — most agents have many trials).
   */
  knownAgents?: Set<string>;
}

/**
 * Validate a trial JSONL file at `corpusPath`. File does not need to exist
 * (returns an empty-but-OK report). Each line is parsed independently; a
 * torn (truncated mid-JSON) line counts toward `tornLines` and is skipped.
 *
 * The function does NOT mutate the file. Callers wanting to repair a corpus
 * should re-write surviving valid trials to a new file.
 */
export async function validateTrialCorpus(
  corpusPath: string,
  opts: ValidateCorpusOpts = {},
): Promise<ValidationReport> {
  let raw: string;
  try {
    raw = await fs.readFile(corpusPath, "utf8");
  } catch {
    return emptyReport();
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const tally = new TrialTally();

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      tally.tornLines++;
      continue;
    }
    const result = TrialSchema.safeParse(parsed);
    if (!result.success) {
      // Schema-fail but JSON-valid → count as torn (corpus integrity issue).
      tally.tornLines++;
      continue;
    }
    tally.add(result.data);
  }

  return tally.report(opts.knownAgents);
}

function emptyReport(): ValidationReport {
  return {
    ok: true,
    tornLines: 0,
    orphanAgentRefs: 0,
    collisions: 0,
    missingMetrics: 0,
    agentsSeen: [],
    collidingTrialIds: [],
    trialIdsMissingMetrics: [],
  };
}

class TrialTally {
  tornLines = 0;
  private trialIdCounts = new Map<string, number>();
  private agentCounts = new Map<string, number>();
  private missingMetricIds: string[] = [];

  add(trial: ReturnType<typeof TrialSchema.parse>): void {
    this.trialIdCounts.set(trial.id, (this.trialIdCounts.get(trial.id) ?? 0) + 1);
    this.agentCounts.set(trial.agent, (this.agentCounts.get(trial.agent) ?? 0) + 1);
    if (typeof trial.score.cost_usd !== "number" || typeof trial.score.latency_ms !== "number") {
      this.missingMetricIds.push(trial.id);
    }
  }

  report(knownAgents?: Set<string>): ValidationReport {
    const collidingTrialIds: string[] = [];
    for (const [id, count] of this.trialIdCounts) {
      if (count > 1) collidingTrialIds.push(id);
    }
    let orphanAgentRefs = 0;
    if (knownAgents) {
      for (const agent of this.agentCounts.keys()) {
        if (!knownAgents.has(agent)) orphanAgentRefs++;
      }
    } else {
      // Heuristic: agents appearing exactly once are likely typos / strays.
      for (const [, count] of this.agentCounts) {
        if (count === 1) orphanAgentRefs++;
      }
    }
    const collisions = collidingTrialIds.length;
    const missingMetrics = this.missingMetricIds.length;
    return {
      ok: this.tornLines === 0 && collisions === 0 && missingMetrics === 0 && orphanAgentRefs === 0,
      tornLines: this.tornLines,
      orphanAgentRefs,
      collisions,
      missingMetrics,
      agentsSeen: [...this.agentCounts.keys()].sort(),
      collidingTrialIds,
      trialIdsMissingMetrics: this.missingMetricIds,
    };
  }
}
