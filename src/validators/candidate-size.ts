import { readFileSync } from "node:fs";
import type { Candidate } from "../types/candidate.ts";

export function validateCandidateSize(
  candidate: Candidate,
  maxLines: number,
): { ok: boolean; reason?: string } {
  const body = readFileSync(candidate.prompt_path, "utf8");
  const lines = body.split("\n").length;
  if (lines > maxLines) {
    return { ok: false, reason: `oversized_candidate (${lines} lines > ${maxLines})` };
  }
  return { ok: true };
}
