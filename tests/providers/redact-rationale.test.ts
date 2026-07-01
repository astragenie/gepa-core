/**
 * tests/providers/redact-rationale.test.ts
 *
 * SLICE-101: PII / secret scrubbing for judge rationales.
 */

import { describe, expect, test } from "bun:test";
import { containsSecretShape, redactRationale } from "../../src/providers/redact-rationale.ts";

describe("SLICE-101 — redactRationale built-in patterns", () => {
  test("OpenAI sk- keys redacted", () => {
    const out = redactRationale("The user pasted sk-proj-abc123def456ghi789jkl012mno345 inline.");
    expect(out).not.toContain("sk-proj-abc123");
    expect(out).toContain("[REDACTED]");
  });

  test("Anthropic sk-ant- keys redacted", () => {
    const out = redactRationale("Token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789");
    expect(out).not.toContain("sk-ant-api03");
  });

  test("GitHub PAT redacted", () => {
    // GH PAT is exactly 36 alphanumeric chars after ghp_ prefix.
    const body = "AbCdEf1234567890aBcDeFgHiJkLMnOpQrSt"; // 36 chars
    expect(body.length).toBe(36);
    const out = redactRationale(`Set GH_TOKEN=ghp_${body}`);
    expect(out).not.toContain(body);
  });

  test("npm token redacted", () => {
    // npm tokens are 36 chars after npm_ prefix.
    const body = "AbCdEf1234567890aBcDeFgHiJkLMnOpQrSt"; // 36 chars
    expect(body.length).toBe(36);
    const out = redactRationale(`Set NPM_TOKEN=npm_${body}`);
    expect(out).not.toContain(body);
  });

  test("JWT-shape token redacted", () => {
    const out = redactRationale(
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4",
    );
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiI");
  });

  test("Bearer header keeps label but redacts value", () => {
    const out = redactRationale("Authorization: Bearer 1234567890abcdefghij1234567890");
    expect(out).toContain("Authorization: Bearer");
    expect(out).not.toContain("1234567890abcdefghij");
  });

  test("email addresses redacted", () => {
    const out = redactRationale("Sent from alice@example.com to bob.smith+tag@company.co.uk");
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("bob.smith");
  });

  test("benign text untouched", () => {
    const text = "The diff removes the null guard at line 14 and accesses order.items.";
    expect(redactRationale(text)).toBe(text);
  });

  test("empty input returns empty string", () => {
    expect(redactRationale("")).toBe("");
  });

  test("custom replacement string applied", () => {
    const out = redactRationale("Key: sk-test-1234567890abcdef1234567890ABCDEF", {
      replacement: "<<SCRUBBED>>",
    });
    expect(out).toContain("<<SCRUBBED>>");
    expect(out).not.toContain("sk-test-1234567890");
  });

  test("additional caller patterns applied after built-ins", () => {
    const out = redactRationale("internal-id: ABC-12345", {
      additional: [/internal-id:\s*[A-Z]{3}-\d{5}/g],
    });
    expect(out).not.toContain("ABC-12345");
  });
});

describe("SLICE-101 — containsSecretShape detector", () => {
  test("true when text contains a secret-shape token", () => {
    expect(containsSecretShape("Token sk-test-1234567890abcdef1234567890ABCDEF here")).toBe(true);
  });

  test("false on benign prose", () => {
    expect(containsSecretShape("The candidate response identified a null deref.")).toBe(false);
  });

  test("false on empty input", () => {
    expect(containsSecretShape("")).toBe(false);
  });

  test("detects email shape", () => {
    expect(containsSecretShape("alice@example.com")).toBe(true);
  });

  test("pattern lastIndex reset between calls (re-callable)", () => {
    const text = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456789";
    expect(containsSecretShape(text)).toBe(true);
    // Second call should still return true (no global-regex state leakage).
    expect(containsSecretShape(text)).toBe(true);
  });
});
