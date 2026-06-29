# @astragenie/gepa-core

GEPA reflective prompt evolution toolkit. Capture agent traces, score candidate prompts with pluggable LLM judges, Pareto-rank, and promote winners. Pure ESM library — zero hard Claude Code, runner-plugin, memory-plugin, or cloud-SDK dependencies in the default build.

## Install

```sh
npm install @astragenie/gepa-core
```

## Quick start

```ts
import { fileStore, sequentialRunner, binaryScorer, paretoRank } from "@astragenie/gepa-core";

const store = fileStore(".claude/artifacts/crew/gepa/trials");
const runner = sequentialRunner();
const scorer = binaryScorer("inspector");

// ... see docs/superpowers/specs/2026-06-27-gepa-skill-improvement-loop-design.md for full wiring
```

## Providers (v0.3.0+)

Four pluggable judge/candidate adapters ship as discrete entry points:

```ts
import { OllamaJudge } from "@astragenie/gepa-core/providers/ollama";
import { GenericOpenAIJudge } from "@astragenie/gepa-core/providers/generic-openai";
import { GroqJudge } from "@astragenie/gepa-core/providers/groq";
import { GeminiJudge } from "@astragenie/gepa-core/providers/gemini";
```

All providers implement `LLMJudge`, use native `fetch`, and require **no SDK runtime
dependencies** by default. Pass env vars via constructor config — providers never
read `process.env` directly.

### Peer-dep table

| Provider | Optional SDK | Install command | Notes |
|---|---|---|---|
| `providers/ollama` | none | — | Pure fetch, no SDK |
| `providers/generic-openai` | none | — | Pure fetch, no SDK |
| `providers/groq` | none | — | Pure fetch (OpenAI-compat) |
| `providers/gemini` | `@google/generative-ai` | `npm install @google/generative-ai` | Optional; provider uses native fetch by default |

### Config-only constructors

```ts
// Ollama — all fields optional (defaults: host=localhost:11434, model=llama3.3)
const ollama = new OllamaJudge({ host: process.env.OLLAMA_HOST, model: "llama3.3" });

// GenericOpenAI — baseUrl + apiKey + model required
const openai = new GenericOpenAIJudge({
  baseUrl: "https://api.openai.com",
  apiKey: process.env.OPENAI_API_KEY ?? "",
  model: "gpt-4o-mini",
});

// Groq — apiKey required
const groq = new GroqJudge({ apiKey: process.env.GROQ_API_KEY ?? "" });

// Gemini — apiKey required
const gemini = new GeminiJudge({ apiKey: process.env.GEMINI_API_KEY ?? "" });
```

## License

MIT.
