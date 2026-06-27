import { z } from "zod";

export const CandidateSchema = z.object({
  id: z.string().uuid(),
  agent: z.string(),
  prompt_path: z.string(),
  prompt_hash: z.string(),
  prompt_size_lines: z.number().int().positive(),
  derived_from_trials: z.array(z.string().uuid()),
  generator_cost_usd: z.number().nonnegative(),
  created_at: z.string().datetime(),
});

export type Candidate = z.infer<typeof CandidateSchema>;
