/**
 * tests/validators/validate-trial-corpus.test.ts
 *
 * SLICE-100 AC-6 + AC-7.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateTrialCorpus } from "../../src/validators/validate-trial-corpus.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "validate-corpus-"));
}

function makeTrial(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    agent: "fullstack-dev",
    phase: "build",
    candidate_prompt_hash: "abc123",
    candidate_prompt_path: "agents/fullstack-dev.md",
    input: null,
    output: "...",
    score: {
      pass: true,
      score: 0.85,
      cost_usd: 0.01,
      latency_ms: 500,
    },
    source: "eval",
    pareto_rank: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

async function writeJsonl(filePath: string, trials: Record<string, unknown>[]): Promise<void> {
  await fs.writeFile(filePath, trials.map((t) => JSON.stringify(t)).join("\n"), "utf8");
}

describe("SLICE-100 AC-6 — validateTrialCorpus identifies torn lines", () => {
  test("clean corpus: ok=true, all counters zero", async () => {
    const file = join(tmp(), "corpus.jsonl");
    const trials = Array.from({ length: 10 }, (_, i) =>
      makeTrial({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}` }),
    );
    await writeJsonl(file, trials);
    const report = await validateTrialCorpus(file);
    expect(report.ok).toBe(true);
    expect(report.tornLines).toBe(0);
    expect(report.collisions).toBe(0);
    expect(report.missingMetrics).toBe(0);
  });

  test("torn lines counted (truncated mid-JSON)", async () => {
    const file = join(tmp(), "corpus.jsonl");
    const trial1 = JSON.stringify(makeTrial());
    const trial2 = JSON.stringify(makeTrial());
    const torn = trial1.slice(0, Math.floor(trial1.length / 2)); // half-cut
    const garbage = "{not valid json";
    await fs.writeFile(file, [torn, trial1, garbage, trial2].join("\n"), "utf8");
    const report = await validateTrialCorpus(file);
    expect(report.tornLines).toBe(2);
    expect(report.ok).toBe(false);
  });

  test("non-existent file returns empty-but-ok report", async () => {
    const report = await validateTrialCorpus(join(tmp(), "does-not-exist.jsonl"));
    expect(report.ok).toBe(true);
    expect(report.tornLines).toBe(0);
    expect(report.agentsSeen).toEqual([]);
  });
});

describe("SLICE-100 AC-7 — collisions + missingMetrics", () => {
  test("duplicate trial_id counted as collision", async () => {
    const file = join(tmp(), "corpus.jsonl");
    const id = "00000000-0000-4000-8000-000000000001";
    await writeJsonl(file, [makeTrial({ id }), makeTrial({ id }), makeTrial()]);
    const report = await validateTrialCorpus(file);
    expect(report.collisions).toBe(1);
    expect(report.collidingTrialIds).toContain(id);
    expect(report.ok).toBe(false);
  });

  test("multiple distinct collisions counted separately", async () => {
    const file = join(tmp(), "corpus.jsonl");
    const idA = "00000000-0000-4000-8000-00000000aaaa";
    const idB = "00000000-0000-4000-8000-00000000bbbb";
    await writeJsonl(file, [
      makeTrial({ id: idA }),
      makeTrial({ id: idA }),
      makeTrial({ id: idB }),
      makeTrial({ id: idB }),
      makeTrial(),
    ]);
    const report = await validateTrialCorpus(file);
    expect(report.collisions).toBe(2);
    expect(report.collidingTrialIds).toEqual(expect.arrayContaining([idA, idB]));
  });

  test("agents summary lists distinct agents seen", async () => {
    const file = join(tmp(), "corpus.jsonl");
    await writeJsonl(file, [
      makeTrial({ agent: "fullstack-dev" }),
      makeTrial({ agent: "inspector" }),
      makeTrial({ agent: "verifier" }),
      makeTrial({ agent: "inspector" }),
    ]);
    const report = await validateTrialCorpus(file);
    expect(report.agentsSeen).toEqual(["fullstack-dev", "inspector", "verifier"]);
  });

  test("knownAgents set: agent not in set counts as orphan", async () => {
    const file = join(tmp(), "corpus.jsonl");
    await writeJsonl(file, [
      makeTrial({ agent: "fullstack-dev" }),
      makeTrial({ agent: "typo-agent" }),
      makeTrial({ agent: "inspector" }),
    ]);
    const report = await validateTrialCorpus(file, {
      knownAgents: new Set(["fullstack-dev", "inspector", "verifier"]),
    });
    expect(report.orphanAgentRefs).toBe(1);
  });
});
