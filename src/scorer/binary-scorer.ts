import type { Scorer } from "../interfaces.ts";

export interface BinaryDispatcher {
  dispatch(opts: {
    agent: string;
    input: unknown;
    expectedOutput: unknown;
  }): Promise<{ pass: boolean; cost_usd: number; latency_ms: number; rationale?: string }>;
}

export function binaryScorer(passAgent: string, deps: BinaryDispatcher): Scorer {
  return {
    async score(run, expected) {
      const verdict = await deps.dispatch({
        agent: passAgent,
        input: { candidate_output: run.raw_output, case: expected },
        expectedOutput: expected.expected_output,
      });
      return {
        pass: verdict.pass,
        score: verdict.pass ? 1 : 0,
        cost_usd: verdict.cost_usd,
        latency_ms: verdict.latency_ms,
        rationale: verdict.rationale,
      };
    },
  };
}
