/**
 * resolveJudge — per-agent judge factory.
 *
 * SLICE-101 (FEAT-183 S5b). Takes a `GepaConfig`, an agent name, and a
 * caller-supplied `JudgeRegistry` mapping `provider -> factory`, and
 * returns the resolved `LLMJudge` instance. Looks up `judge_per_agent[<agent>]`
 * first; falls back to the top-level `judge` block when the agent has no
 * override.
 *
 * Why caller supplies the registry: each provider lives at its own package
 * entry point (`@astragenie/gepa-core/providers/<name>`) so consumers only
 * pull in the providers they actually use. resolveJudge stays in the core
 * entry and remains tree-shake-friendly.
 *
 * Example:
 * ```ts
 * import { resolveJudge } from "@astragenie/gepa-core";
 * import { OllamaJudge } from "@astragenie/gepa-core/providers/ollama";
 * import { GeminiJudge } from "@astragenie/gepa-core/providers/gemini";
 *
 * const registry: JudgeRegistry = {
 *   ollama: (cfg) => new OllamaJudge({ model: cfg.model, host: cfg.endpoint }),
 *   gemini: (cfg) => new GeminiJudge({ model: cfg.model, apiKey: cfg.api_key }),
 * };
 * const judge = resolveJudge(gepaConfig, "fullstack-dev", registry);
 * ```
 */

import type { LLMJudge } from "../interfaces.ts";
import type { GepaConfig } from "../types/gepa-config.ts";

/**
 * Resolved judge config — a flat shape factories can consume directly without
 * caring about `judge` vs `judge_per_agent` lookup nuances.
 */
export interface ResolvedJudgeConfig {
  provider: string;
  model: string;
  endpoint?: string;
  deployment?: string;
  /** API key value (NOT the env var name). Resolved by the consumer shim
   * layer before being passed into the factory — see `api_key_env` in
   * GepaConfigSchema. */
  api_key?: string;
}

/**
 * Factory function — takes resolved config, returns an LLMJudge instance.
 * Caller wires one factory per provider name. Factories MAY throw on
 * invalid config; resolveJudge surfaces the error to caller.
 */
export type JudgeFactory = (config: ResolvedJudgeConfig) => LLMJudge;

/** Map from provider name to factory. Caller-supplied so resolveJudge is
 * tree-shake-friendly. */
export type JudgeRegistry = Record<string, JudgeFactory>;

export interface ResolveJudgeOpts {
  /** Optional override: lookup by API key value (resolved from env or
   * .npmrc). Default: undefined — factories that need a key throw if absent. */
  apiKey?: string;
}

/**
 * Resolve the right LLMJudge for `agent`. Throws if the provider named in
 * the resolved config has no factory in the registry.
 */
export function resolveJudge(
  config: GepaConfig,
  agent: string,
  registry: JudgeRegistry,
  opts: ResolveJudgeOpts = {},
): LLMJudge {
  const resolved = resolveJudgeConfig(config, agent);
  if (opts.apiKey !== undefined) resolved.api_key = opts.apiKey;

  const factory = registry[resolved.provider];
  if (!factory) {
    const known = Object.keys(registry).sort().join(", ") || "(none)";
    throw new Error(
      `resolveJudge: no factory registered for provider "${resolved.provider}". Known providers: ${known}. Wire a factory in the JudgeRegistry passed to resolveJudge.`,
    );
  }
  return factory(resolved);
}

/**
 * Resolve the flat judge config for `agent` — `judge_per_agent[<agent>]`
 * if present, otherwise the top-level `judge` block. Exposed for callers
 * that want to inspect the resolved config without instantiating a judge.
 */
export function resolveJudgeConfig(config: GepaConfig, agent: string): ResolvedJudgeConfig {
  const perAgent = config.judge_per_agent[agent];
  const source = perAgent ?? config.judge;
  const resolved: ResolvedJudgeConfig = {
    provider: source.provider,
    model: source.model,
  };
  if (source.endpoint !== undefined) resolved.endpoint = source.endpoint;
  if (source.deployment !== undefined) resolved.deployment = source.deployment;
  return resolved;
}
