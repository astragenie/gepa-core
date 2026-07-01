export * from "./types/index.ts";
export type {
  Scorer,
  TrialStore,
  RunnerAdapter,
  CandidateGenerator,
  PromotionPolicy,
  BudgetMeter,
  LLMJudge,
  LockManager,
} from "./interfaces.ts";

export { fileStore } from "./store/file-store.ts";
export { sequentialRunner } from "./runner/sequential-runner.ts";
export { binaryScorer } from "./scorer/binary-scorer.ts";
export { rubricScorer, type RubricScorerOpts } from "./scorer/rubric-scorer.ts";
export { dailyCapMeter } from "./budget/daily-cap-meter.ts";
export { fileLockManager } from "./lock/file-lock-manager.ts";
export { dominates, paretoRank } from "./pareto/rank.ts";
export { validateCandidateSize } from "./validators/candidate-size.ts";
export {
  validateTrialCorpus,
  type ValidationReport,
  type ValidateCorpusOpts,
} from "./validators/validate-trial-corpus.ts";
export {
  detectEvalDrift,
  detectEvalDriftFromSplits,
  type DriftReport,
  type DetectDriftOpts,
} from "./validators/detect-eval-drift.ts";
export {
  resolveJudge,
  resolveJudgeConfig,
  type JudgeFactory,
  type JudgeRegistry,
  type ResolvedJudgeConfig,
  type ResolveJudgeOpts,
} from "./providers/resolve-judge.ts";
export {
  redactRationale,
  containsSecretShape,
  type RedactRationaleOpts,
} from "./providers/redact-rationale.ts";
export {
  loadRubric,
  parseRubricMarkdown,
  type LoadRubricOpts,
} from "./providers/load-rubric.ts";
