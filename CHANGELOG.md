# Changelog

All notable changes to `@astragenie/gepa-core` follow semantic versioning.

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
