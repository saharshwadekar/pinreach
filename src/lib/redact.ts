// Hides anything personal or secret before a log leaves the browser (the "Copy log" button).
const SENSITIVE_KEY = /cookie|auth|token|csrf|xsrf|session|secret|signature|password|otp|phone|mobile|email|address_?line|name_?on|customer|user_?id/i;
const MAX_STRING = 20000;

type Limits = { depth: number; items: number; chars: number };

/** Keeps the shape of a value but cuts long lists, long strings and deep nesting. */
export function shrink(value: unknown, l: Limits, depth = 0): unknown {
  if (typeof value === "string") return value.length > l.chars ? `${value.slice(0, l.chars)}…[+${value.length - l.chars} chars]` : value;
  if (!value || typeof value !== "object") return value;
  if (depth >= l.depth) return Array.isArray(value) ? `[list of ${value.length}]` : "[object]";
  if (Array.isArray(value)) {
    const head = value.slice(0, l.items).map((v) => shrink(v, l, depth + 1));
    return value.length > l.items ? [...head, `…[+${value.length - l.items} more]`] : head;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v, l, depth + 1)]));
}

/** Compact one-line JSON under `maxChars`, tightening the limits until it fits. */
export function compactJson(value: unknown, maxChars = 30000): string {
  const steps: Limits[] = [
    { depth: 10, items: 8, chars: 600 },
    { depth: 8, items: 5, chars: 300 },
    { depth: 6, items: 3, chars: 160 },
    { depth: 4, items: 2, chars: 80 },
  ];
  let out = "";
  for (const l of steps) {
    out = JSON.stringify(shrink(value, l));
    if (out.length <= maxChars) return out;
  }
  return out.slice(0, maxChars) + "…[cut]";
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 30) return "[deep]";
  if (typeof value === "string") {
    const s = value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…[truncated]" : value;
    // Emails and 10-digit Indian mobile numbers inside free text.
    return s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/(?<!\d)[6-9]\d{9}(?!\d)/g, "[phone]");
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
    );
  }
  return value;
}
