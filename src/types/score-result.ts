import { z } from "zod";

export const ScoreResultSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  rubric: z.record(z.string(), z.number()).optional(),
  cost_usd: z.number().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  rationale: z.string().optional(),
});

export type ScoreResult = z.infer<typeof ScoreResultSchema>;
