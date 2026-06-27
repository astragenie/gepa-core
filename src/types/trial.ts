import { z } from "zod";
import { ScoreResultSchema } from "./score-result.ts";

export const TrialSchema = z.object({
  id: z.string().uuid(),
  agent: z.string(),
  phase: z.enum(["build", "review", "validate", "ship"]),
  candidate_prompt_hash: z.string(),
  candidate_prompt_path: z.string().nullable(),
  input: z.unknown(),
  output: z.unknown(),
  score: ScoreResultSchema,
  source: z.enum(["eval", "captured", "soak"]),
  pareto_rank: z.number().int().nullable(),
  created_at: z.string().datetime(),
});

export type Trial = z.infer<typeof TrialSchema>;

export function newTrialId(): string {
  return crypto.randomUUID();
}
