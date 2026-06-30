# Changelog

All notable changes to `@astragenie/gepa-core` follow semantic versioning.

## 0.4.0 (2026-06-30)

**MINOR** — purely additive type export. Zero breaking changes to existing
runtime exports. Consumers pinned to `^0.3.0` resolve this version
automatically.

### Added

- `JudgeCost` type — canonical cost shape across all judge evaluations
  (FEAT-186 S1). Fields: `usd: number`, `latency_ms: number`,
  `tokens?: { in, out }`, `cache?: { hit, tokens_saved? }`. Both `tokens`
  and `cache` MUST stay optional forever (locked by `tests/judge/judge-cost-shape.test.ts`)
  so provider adapters that cannot surface a field (e.g. ollama has no
  prompt cache; `claude-p` subprocess cannot surface tokens) leave the
  field unset rather than fabricate zeros.

### Why this lands now

Prerequisite for FEAT-183 wave-plan WAVE 1: `dailyCapMeter` (FEAT-186 S2)
and per-slice cost report renderer (FEAT-186 S3) both ingest `JudgeCost`.
SLICE-98 will start writing trials in this canonical shape. Without the
type landed in advance, the consumer-side ingestion would diverge between
the evals pipeline and the gepa pipeline — exactly the dual-cost-shape
problem FEAT-186 was spun out to close.

### Not changed

- `LLMJudge.evaluate()` return shape — unchanged. Still returns the flat
  fields (`cost_usd`, `latency_ms`, `tokens?`) it has shipped since
  0.2.0. Consumers that want the canonical `JudgeCost` shape will use a
  `toJudgeCost(result)` helper added in S2.
- `dailyCapMeter.record()` signature — unchanged. Widened in S2.
- All provider adapters (ollama, generic-openai, groq, gemini) — unchanged.

## 0.3.1 (2026-06-29)

**PATCH** — wires `OllamaConfig.temperature` through to the Ollama `/api/chat`
request body. Before 0.3.1 the field was declared on the interface but
silently dropped on the way to the API (no instance storage, not in the body).

### Fixed

- `OllamaJudge`: `config.temperature` now lands in `body.options.temperature`
  per the Ollama API spec. Default remains `0.0` so existing deterministic
  callers see no behavior change. Found by `crew:inspector` on SLICE-108
  review (2026-06-29). Regression test added in
  `tests/providers/ollama.test.ts`.

## 0.3.0 (2026-06-29)

**MINOR** — purely additive. Zero breaking changes to the existing `"."` entry
point. Consumers pinned to `^0.2.1` resolve this version automatically.

### Added

Four new discrete entry points under `providers/`:

| Entry point | Class | Use case |
|---|---|---|
| `@astragenie/gepa-core/providers/ollama` | `OllamaJudge` | Local/offline judge via Ollama /api/chat |
| `@astragenie/gepa-core/providers/generic-openai` | `GenericOpenAIJudge` | Any /v1/chat/completions-compatible API |
| `@astragenie/gepa-core/providers/groq` | `GroqJudge` | Groq free-tier judge (extends GenericOpenAIJudge) |
| `@astragenie/gepa-core/providers/gemini` | `GeminiJudge` | Google Gemini via native fetch |

All four providers:
- Implement `LLMJudge` from `@astragenie/gepa-core`.
- Accept a typed config object in their constructors.
- **Zero `process.env` access** — env reads belong in the consumer shim layer
  (enforced by `scripts/check-no-env-reads.ts`; runs as `bun run check:no-env`).
- Use native `fetch` — no npm runtime dependencies beyond `@astragenie/gepa-core` itself.

### Naming rationale: `providers/` not `judges/`

The directory is named `providers/` rather than `judges/` because these adapters
serve dual roles: LLM judge evaluation AND candidate dispatch (FEAT-185 Option 1).
The `LLMJudge` interface name is preserved for backward compat.

### AC-9 callout: claude-p stays in dev-team

`claude-p` is intentionally NOT included in this release. It remains in
`dev-team/evals/providers/claude-p.ts` because:

1. It launches `claude -p` as a subprocess — requires `node:child_process`.
2. It has Windows-specific path handling.
3. It carries FEAT-173 tempdir-isolation logic that is tightly coupled to
   the dev-team runner environment.

This is FEAT-185 Option 1 scope boundary. A future FEAT may relocate it.

### Peer-dep table

| Provider | Optional SDK | Install command | Notes |
|---|---|---|---|
| `providers/ollama` | none | — | Pure fetch, no SDK |
| `providers/generic-openai` | none | — | Pure fetch, no SDK |
| `providers/groq` | none | — | Pure fetch (OpenAI-compat) |
| `providers/gemini` | `@google/generative-ai` | `npm install @google/generative-ai` | Optional; provider uses native fetch by default |

The `@google/generative-ai` package is listed in `peerDependenciesMeta` as
optional. The `GeminiJudge` implementation uses native fetch and does **not**
require the SDK at runtime. The peer-dep listing exists so tooling can surface
the install hint and the CI matrix can test SDK presence/absence.

### CI scaffold

`peer-dep-matrix` GitHub Actions job: 3 OSes × 2 SDK states × 4 providers
= 24 matrix cells. Verifies constructibility and `describe()` round-trip per
cell. SLICE-109 will extend to 36 cells when azure + bedrock providers are added.

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
