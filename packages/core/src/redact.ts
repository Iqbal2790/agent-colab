const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|passwd|auth|credential|private[_-]?key|bearer)/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9_-]{16,}/g,
  /sk-ant-[a-zA-Z0-9_-]{16,}/g,
  /ghp_[a-zA-Z0-9]{20,}/g,
  /github_pat_[a-zA-Z0-9_]{20,}/g,
  /AIza[0-9A-Za-z_-]{25,}/g,
  /xox[baprs]-[0-9a-zA-Z-]{16,}/g,
  /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
];

export interface RedactionResult<T> {
  value: T;
  redactedKeys: string[];
}

export function isEnvPlaceholder(val: string): boolean {
  return /^\$\{[A-Z0-9_]+\}$/.test(val.trim());
}

export function redactString(input: string): { value: string; count: number } {
  let out = input;
  let count = 0;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, () => {
      count += 1;
      return '${REDACTED_SECRET}';
    });
  }
  return { value: out, count };
}

export function redactEnvRecord(
  record?: Record<string, string>
): RedactionResult<Record<string, string> | undefined> {
  if (!record) return { value: undefined, redactedKeys: [] };
  const redactedKeys: string[] = [];
  const sanitized: Record<string, string> = {};

  for (const [key, rawVal] of Object.entries(record)) {
    if (typeof rawVal !== 'string') {
      sanitized[key] = String(rawVal);
      continue;
    }
    if (isEnvPlaceholder(rawVal)) {
      sanitized[key] = rawVal;
      continue;
    }
    const envVarName = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const isSensitiveKey = SENSITIVE_KEY_PATTERN.test(key);
    const valueCheck = redactString(rawVal);

    if (isSensitiveKey && rawVal.trim().length > 0) {
      sanitized[key] = `\${${envVarName}}`;
      redactedKeys.push(key);
    } else if (valueCheck.count > 0) {
      sanitized[key] = `\${${envVarName}}`;
      redactedKeys.push(key);
    } else {
      sanitized[key] = rawVal;
    }
  }

  return { value: sanitized, redactedKeys };
}
