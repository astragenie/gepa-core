# Changelog

All notable changes to `@astragenie/gepa-core` follow semantic versioning.

## 0.2.1 (2026-06-29)

**Republish, no content change.** Version `0.2.0` hit npm's 24-hour unpublish lockout
(version slot reserved after early unpublish), blocking a fresh publish under the same
number. `0.2.1` ships the identical source tree as the intended `0.2.0` payload.

Also includes the `.gitattributes` LF pin (commit `7ab6592`) so Windows clones keep
`bun run format:check` green.

## 0.2.0 (2026-06-28)

**MAJOR** (pre-1.0 convention: `0.x → 0.y` is breaking when result fields are added that
user-implemented judges must produce). Audit confirms zero external `LLMJudge` implementers at
time of release (FEAT-184 AC-9); migration cost is nil in practice.

### Breaking changes

- `LLMJudge.evaluate()` result now includes `tokens?: { in: number; out: number }` and
  `raw?: unknown`. Existing mock implementations that return only the previous six fields
  (`pass`, `score`, `rubricScores`, `rationale`, `cost_usd`, `latency_ms`) continue to
  satisfy the interface because both new fields are optional — TypeScript-compatible, but
  documented as MAJOR because callers that _consume_ `evaluate()` results may now rely on
  these fields being present.
- `LLMJudge.evaluate()` opts now include `context?: { fixture?, promptId?, version? }`.
  Adapter implementations MUST forward this field to their observability / Langfuse layer;
  silently dropping it breaks provenance tracking.

### Added

- `tokens?: { in: number; out: number }` on `LLMJudge` result — load-bearing for
  `evals/cli.ts` cost-attribution telemetry in `dev-team`. Maps from
  `providerCost.{tokensIn,tokensOut}` in the old `JudgeProvider` shape.
- `raw?: unknown` on `LLMJudge` result — load-bearing for Langfuse debug emission
  (FEAT-169 SLICE-90).
- `context?: { fixture?, promptId?, version? }` on `LLMJudge.evaluate()` opts — carries
  Langfuse provenance fields through evaluate(); adapters must not drop it.

### Migration guide

**For `LLMJudge` implementers** (zero external today; documented for posterity):

1. Your `evaluate()` method signature is unchanged — both new result fields are optional.
2. To surface token counts: populate `tokens: { in: promptTokens, out: completionTokens }`.
3. To surface the raw provider response: populate `raw: <whatever the SDK returns>`.
4. To forward context: read `opts.context` and pass it to your Langfuse/OTel span.

**For `LLMJudge` callers** (e.g. `rubricScorer`, `evals/lib/run-eval.ts`):

- `tokens` and `raw` are optional; guard with `result.tokens?.in` etc.
- `context` flows in via opts — pass `{ fixture, promptId, version }` from your call site.

**For `JudgeProvider` adapters in `dev-team`** (FEAT-184 dev-team PR):

- `dev-team` `evals/lib/judge.ts` re-exports `LLMJudge` as the canonical type.
- The old `JudgeProvider` interface becomes a `@deprecated` alias for one minor version.
- All 7 adapters gain a `describe()` method (trivial: `describe = () => ({ provider: "groq", model: this.model })`).
- Rubric `string → string[]` migration: wrap-in-single-element `[oneString]` — never sentence-split.

## 0.1.0 (unreleased)

Initial release. Bootstrap of the GEPA reflective prompt evolution toolkit.

### Added

- Zod schemas: `Trial`, `EvalCase`, `ScoreResult`, `CrewArtifact`, `AgentRun`, `Candidate`, `GepaConfig`.
- Interfaces: `Scorer`, `TrialStore`, `RunnerAdapter`, `CandidateGenerator`, `PromotionPolicy`, `BudgetMeter`, `LLMJudge`, `LockManager`.
- Built-ins: `fileStore`, `sequentialRunner`, `binaryScorer`, `dailyCapMeter`, `fileLockManager`.
- Pure helpers: `paretoRank`, `dominates`, `validateCandidateSize`.
