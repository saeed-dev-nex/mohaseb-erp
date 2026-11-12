/** Extract validation messages, never raw transport/debug metadata or HTML. */
export function formatApiError(error, fallback) {
  const payload =
    error?.response?.data ?? (error instanceof Error ? null : error);
  const seen = new Set();
  const messages = [];
  const visit = (value, depth = 0) => {
    if (depth > 5) return;
    if (typeof value === "string") {
      const message = value.trim();
      if (message && !/<\/?[a-z][^>]*>/i.test(message)) messages.push(message);
    } else if (value && typeof value === "object" && !seen.has(value)) {
      seen.add(value);
      const values = Array.isArray(value) ? value : Object.values(value);
      values.forEach((item) => visit(item, depth + 1));
    }
  };
  visit(payload);
  return [...new Set(messages)].join(" ") || fallback;
}
