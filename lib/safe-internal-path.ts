const INTERNAL_BASE_URL = "https://internal.invalid";
const UNSAFE_PATH_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

export function safeInternalPath(input: string | null | undefined, fallback = "/") {
  if (typeof input !== "string" || !input.startsWith("/") || input.length > 2048) return fallback;
  if (input.startsWith("//") || UNSAFE_PATH_CHARACTERS.test(input)) return fallback;

  try {
    const parsed = new URL(input, INTERNAL_BASE_URL);
    if (parsed.origin !== INTERNAL_BASE_URL) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
