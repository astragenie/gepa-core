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

## License

MIT.
