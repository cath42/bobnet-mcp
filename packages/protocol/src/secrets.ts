// Messages carry paths, not content. The broker rejects any text that looks
// like a credential so nothing secret is ever stored in the cloud.

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["anthropic_key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai_key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["aws_access_key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ["slack_token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["bearer", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/],
  // No `\` in the value: a JSON escape (a newline as `\n`) can't carry a match across what the field
  // keeps apart, so the serialised body matches only where a field does (ADR 0007 §2).
  ["password_assignment", /\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["']?[^\s"'\\]{8,}/i],
];

/** Returns the name of the first credential pattern found, or null. */
export function findSecret(text: string): string | null {
  for (const [name, re] of PATTERNS) if (re.test(text)) return name;
  return null;
}

/**
 * What redaction replaces where it isn't the pattern's own match: a private key's BEGIN line is enough
 * to detect it, but the key is the block through its END line, or the end of the text without one.
 */
const SPANS: Readonly<Record<string, RegExp>> = {
  private_key: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/,
};

/** The text with every span that looks like a credential replaced by `mark`; the rest stays. */
export function redactSecrets(text: string, mark: string): string {
  let out = text;
  for (const [name, found] of PATTERNS) {
    const re = SPANS[name] ?? found;
    out = out.replace(new RegExp(re.source, `${re.flags}g`), mark);
  }
  return out;
}
