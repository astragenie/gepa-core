import { describe, expect, test } from "bun:test";
import { ScoreResultSchema } from "../../src/types/score-result.ts";
import { TrialSchema } from "../../src/types/trial.ts";

describe("ScoreResult", () => {
  test("parses a valid payload", () => {
    const parsed = ScoreResultSchema.parse({
      pass: true,
      score: 0.85,
      cost_usd: 0.0012,
      latency_ms: 420,
    });
    expect(parsed.pass).toBe(true);
    expect(parsed.score).toBe(0.85);
  });

  test("rejects score > 1", () => {
    expect(() =>
      ScoreResultSchema.parse({
        pass: true,
        score: 1.1,
        cost_usd: 0,
        latency_ms: 0,
      }),
    ).toThrow();
  });

  test("rejects negative cost", () => {
    expect(() =>
      ScoreResultSchema.parse({
        pass: false,
        score: 0,
        cost_usd: -0.01,
        latency_ms: 0,
      }),
    ).toThrow();
  });
});

describe("Trial", () => {
  test("parses a valid eval trial", () => {
    const parsed = TrialSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      agent: "fullstack-dev",
      phase: "build",
      candidate_prompt_hash: "deadbeef",
      candidate_prompt_path: null,
      input: { case_id: "c1" },
      output: { ok: true },
      score: { pass: true, score: 0.9, cost_usd: 0.01, latency_ms: 100 },
      source: "eval",
      pareto_rank: 1,
      created_at: "2026-06-27T12:00:00.000Z",
    });
    expect(parsed.agent).toBe("fullstack-dev");
  });

  test("rejects an unknown phase", () => {
    expect(() =>
      TrialSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        agent: "x",
        phase: "deploy", // not allowed
        candidate_prompt_hash: "x",
        candidate_prompt_path: null,
        input: {},
        output: {},
        score: { pass: true, score: 1, cost_usd: 0, latency_ms: 0 },
        source: "eval",
        pareto_rank: null,
        created_at: "2026-06-27T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

import { AgentRunSchema } from "../../src/types/agent-run.ts";
import { CandidateSchema } from "../../src/types/candidate.ts";
import { CrewArtifactSchema } from "../../src/types/crew-artifact.ts";
import { EvalCaseSchema } from "../../src/types/eval-case.ts";
import { GepaConfigSchema } from "../../src/types/gepa-config.ts";

describe("EvalCase", () => {
  test("parses minimal valid case", () => {
    const parsed = EvalCaseSchema.parse({
      id: "case-001",
      input: { prompt: "diff" },
      expected_output: { verdict: "PASS" },
    });
    expect(parsed.held_out).toBe(false);
  });

  test("rejects missing id", () => {
    expect(() => EvalCaseSchema.parse({ input: {} })).toThrow();
  });
});

describe("CrewArtifact", () => {
  test("parses a build-phase artifact", () => {
    const parsed = CrewArtifactSchema.parse({
      agent: "fullstack-dev",
      phase: "build",
      input: {},
      output: {},
      dispatched_at: "2026-06-27T12:00:00.000Z",
    });
    expect(parsed.phase).toBe("build");
  });

  test("score_hint is optional", () => {
    const parsed = CrewArtifactSchema.parse({
      agent: "x",
      phase: "review",
      input: {},
      output: {},
      dispatched_at: "2026-06-27T12:00:00.000Z",
    });
    expect(parsed.score_hint).toBeUndefined();
  });
});

describe("AgentRun", () => {
  test("parses a run", () => {
    const parsed = AgentRunSchema.parse({
      agent: "fullstack-dev",
      candidate_prompt_path: "agents/fullstack-dev.md",
      case_id: "case-001",
      raw_output: "...",
      cost_usd: 0.05,
      latency_ms: 2400,
      finished_at: "2026-06-27T12:00:00.000Z",
    });
    expect(parsed.case_id).toBe("case-001");
  });
});

describe("Candidate", () => {
  test("parses a candidate", () => {
    const parsed = CandidateSchema.parse({
      id: "22222222-2222-4222-8222-222222222222",
      agent: "fullstack-dev",
      prompt_path: ".tmp/gepa/candidates/x.md",
      prompt_hash: "abc",
      prompt_size_lines: 310,
      derived_from_trials: ["33333333-3333-4333-8333-333333333333"],
      generator_cost_usd: 0.12,
      created_at: "2026-06-27T12:00:00.000Z",
    });
    expect(parsed.prompt_size_lines).toBe(310);
  });
});

describe("GepaConfig", () => {
  test("applies defaults for empty config", () => {
    const parsed = GepaConfigSchema.parse({});
    expect(parsed.capture.enabled).toBe(true);
    expect(parsed.storage.backend).toBe("file");
    expect(parsed.judge.provider).toBe("ollama");
    expect(parsed.judge.model).toBe("llama3.2:latest");
    expect(parsed.policy.min_pass_delta).toBeCloseTo(0.05);
    expect(parsed.policy.min_soak_trials).toBe(20);
    expect(parsed.policy.max_soak_days).toBe(21);
  });

  test("rejects unknown judge provider", () => {
    expect(() =>
      GepaConfigSchema.parse({
        judge: { provider: "unknown-provider", model: "x" },
      }),
    ).toThrow();
  });
});
