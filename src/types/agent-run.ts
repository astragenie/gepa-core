import { z } from "zod";

export const AgentRunSchema = z.object({
  agent: z.string(),
  candidate_prompt_path: z.string(),
  case_id: z.string(),
  raw_output: z.unknown(),
  cost_usd: z.number().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  finished_at: z.string().datetime(),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;
