import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TrialStore } from "../interfaces.ts";
import { type Trial, TrialSchema } from "../types/trial.ts";

function jsonlPathFor(root: string, agent: string): string {
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return join(root, `${agent}.jsonl`);
}

function readJsonlSafe(path: string): Trial[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: Trial[] = [];
  for (const line of lines) {
    try {
      out.push(TrialSchema.parse(JSON.parse(line)));
    } catch {
      // Torn or malformed line — drop silently (crash-recovery invariant).
    }
  }
  return out;
}

function matches(trial: Trial, filter: Parameters<TrialStore["recall"]>[0]): boolean {
  if (filter.agent && trial.agent !== filter.agent) return false;
  if (filter.phase && trial.phase !== filter.phase) return false;
  if (filter.source && trial.source !== filter.source) return false;
  if (filter.minScore !== undefined && trial.score.score < filter.minScore) return false;
  if (filter.failuresOnly && trial.score.pass) return false;
  if (filter.since && trial.created_at < filter.since) return false;
  return true;
}

export function fileStore(root: string): TrialStore {
  return {
    async put(trial) {
      const validated = TrialSchema.parse(trial);
      const line = `${JSON.stringify(validated)}\n`;
      appendFileSync(jsonlPathFor(root, validated.agent), line, { flag: "a" });
    },

    async recall(filter) {
      if (!existsSync(root)) return [];
      const files = new Set<string>();
      if (filter.agent) {
        files.add(jsonlPathFor(root, filter.agent));
      } else {
        for (const entry of readdirSync(root)) {
          if (entry.endsWith(".jsonl")) files.add(join(root, entry));
        }
      }
      const trials: Trial[] = [];
      for (const p of files) trials.push(...readJsonlSafe(p));
      const filtered = trials.filter((t) => matches(t, filter));
      filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return filter.limit ? filtered.slice(0, filter.limit) : filtered;
    },

    async invalidate(filter) {
      if (!existsSync(root)) return 0;
      const files = readdirSync(root)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(root, f));
      let purgeCount = 0;
      for (const p of files) {
        const trials = readJsonlSafe(p);
        const kept = trials.filter((t) => {
          if (filter.trial_ids?.includes(t.id)) {
            purgeCount++;
            return false;
          }
          if (filter.agent && t.agent === filter.agent) {
            purgeCount++;
            return false;
          }
          if (filter.since && t.created_at >= filter.since) {
            purgeCount++;
            return false;
          }
          return true;
        });
        const out = kept.map((t) => `${JSON.stringify(t)}\n`).join("");
        writeFileSync(p, out);
      }
      return purgeCount;
    },
  };
}
