import { z } from "zod";

// gepa.config.json — root config consumer plugin writes.
export const GepaConfigSchema = z.object({
  capture: z
    .object({
      enabled: z.boolean().default(true),
      exclude: z.array(z.string()).default([]), // per-agent disable
      walltime_ms: z.number().int().positive().default(2000),
    })
    .default({}),
  storage: z
    .object({
      backend: z.enum(["file", "astramem"]).default("file"),
      file_root: z.string().default(".claude/artifacts/crew/gepa/trials"),
      astramem_cli_path: z.string().optional(),
    })
    .default({}),
  runner: z
    .object({
      backend: z.enum(["sequential", "wave"]).default("sequential"),
    })
    .default({}),
  judge: z
    .object({
      provider: z.enum(["ollama", "azure-openai", "gemini"]).default("ollama"),
      model: z.string().default("llama3.2:latest"),
      endpoint: z.string().optional(), // ollama: http://localhost:11434; azure: resource endpoint
      deployment: z.string().optional(), // azure: deployment name
      api_key_env: z.string().optional(), // env var name to read key from
    })
    .default({}),
  judge_per_agent: z
    .record(
      z.string(),
      z.object({
        provider: z.enum(["ollama", "azure-openai", "gemini"]),
        model: z.string(),
        endpoint: z.string().optional(),
        deployment: z.string().optional(),
        api_key_env: z.string().optional(),
      }),
    )
    .default({}),
  budget: z
    .object({
      daily_usd: z.number().nonnegative().default(50),
      per_eval_default_usd: z.number().nonnegative().default(2),
      per_optimize_default_usd: z.number().nonnegative().default(5),
    })
    .default({}),
  optimize: z
    .object({
      paused: z.boolean().default(false),
      k: z.number().int().positive().default(5),
    })
    .default({}),
  policy: z
    .object({
      eligible_agents: z.array(z.string()).default([]),
      min_pass_delta: z.number().min(0).max(1).default(0.05),
      min_case_score_floor: z.number().min(0).max(1).default(0.6),
      soak_percent: z.number().min(0).max(1).default(0.1),
      soak_days: z.number().int().positive().default(7),
      min_soak_trials: z.number().int().positive().default(20),
      max_soak_days: z.number().int().positive().default(21),
      soak_epsilon: z.number().min(0).max(1).default(0.02),
      allow_cost_regression: z.boolean().default(false),
      allow_latency_regression: z.boolean().default(false),
    })
    .default({}),
  champion_frozen: z.array(z.string()).default([]), // agents blocked from further optimization
});

export type GepaConfig = z.infer<typeof GepaConfigSchema>;
