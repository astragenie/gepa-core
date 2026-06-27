import { z } from "zod";

export const EvalCaseSchema = z.object({
  id: z.string(),
  input: z.unknown(),
  expected_output: z.unknown().nullable().optional(),
  rubric: z.array(z.string()).optional(),
  held_out: z.boolean().default(false),
  notes: z.string().optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
