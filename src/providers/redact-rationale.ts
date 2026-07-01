/**
 * redactRationale — scrub PII / secrets from judge rationale strings before
 * persistence.
 *
 * SLICE-101 (FEAT-183 S5b). Judges occasionally echo input fixtures back
 * into rationale text. When those fixtures contain secrets (API keys,
 * tokens, emails), the rationale leaks them into the trial corpus. This
 * helper applies a conservative pattern-set BEFORE the trial is written
 * to the store.
 *
 * Patterns intentionally tuned for high precision (avoid corrupting valid
 * rationale prose). Recall is secondary — the goal is to catch
 * obvious-shape leaks like `sk-...`, `ghp_...`, `eyJ...` JWTs, base64
 * blobs over 40 chars, etc. Operators wanting stricter scrubbing supply
 * extra patterns via opts.
 */

export interface RedactRationaleOpts {
  /** Additional regex patterns to redact. Applied AFTER the built-ins. */
  additional?: RegExp[];
  /** Replacement string for matches. Default: "[REDACTED]". */
  replacement?: string;
}

/** Built-in patterns. All flagged `g` so multiple occurrences scrub. */
const BUILT_IN_PATTERNS: RegExp[] = [
  // OpenAI-style API keys
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  // Anthropic-style API keys
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  // GitHub personal access tokens
  /\bghp_[A-Za-z0-9]{36}\b/g,
  // GitHub fine-grained PATs
  /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
  // npm tokens
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  // Generic Bearer / API-key headers (key only, header label preserved)
  /(?<=Authorization:\s*Bearer\s+)[A-Za-z0-9._-]{20,}/gi,
  /(?<=api[_-]?key[=:\s]+)[A-Za-z0-9._-]{20,}/gi,
  // JWT-shape tokens (3 base64url segments, dot-separated, header sized)
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Plain email addresses (broad — covers .com / .org / .io / etc.)
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

/**
 * Apply scrubbing patterns to `text` and return the redacted string. Pure
 * function — no side effects. Empty input returns empty string.
 */
export function redactRationale(text: string, opts: RedactRationaleOpts = {}): string {
  if (!text) return "";
  const replacement = opts.replacement ?? "[REDACTED]";
  let scrubbed = text;
  for (const pattern of BUILT_IN_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  for (const pattern of opts.additional ?? []) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}

/**
 * Quick check: does the text appear to contain any secret-shape token?
 * Useful for asserting in tests that a fixture is clean before commit.
 */
export function containsSecretShape(text: string): boolean {
  return BUILT_IN_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
}
