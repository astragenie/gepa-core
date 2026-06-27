export interface BreakingReport {
  requiresMajor: boolean;
  added: string[];
  removed: string[];
}

export function describeBreakingChanges(before: string[], after: string[]): BreakingReport {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const removed = before.filter((x) => !afterSet.has(x));
  const added = after.filter((x) => !beforeSet.has(x));
  return { requiresMajor: removed.length > 0, added, removed };
}

// CLI entry — diff `src/index.ts` exports against last release.
// Skipped in unit tests; wired into release workflow.
