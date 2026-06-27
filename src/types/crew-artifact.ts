import { z } from "zod";

export const CrewArtifactSchema = z.object({
  agent: z.string(),
  phase: z.enum(["build", "review", "validate", "ship"]),
  input: z.unknown(),
  output: z.unknown(),
  score_hint: z
    .object({
      pass: z.boolean().optional(),
      rubric_signal: z.record(z.string(), z.number()).optional(),
      cost_usd: z.number().nonnegative().optional(),
      latency_ms: z.number().int().nonnegative().optional(),
    })
    .optional(),
  source_artifact_path: z.string().optional(),
  dispatched_at: z.string().datetime(),
});

export type CrewArtifact = z.infer<typeof CrewArtifactSchema>;
