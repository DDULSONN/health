/** Bounded client request; respects caller cancellation, with no automatic retry. */
export async function fetchClientJson<T>(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController();
  const parent = init?.signal;
  const cancel = () => controller.abort();
  if (parent?.aborted) cancel();
  else parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = (await response.json().catch(() => null)) as T | null;
    return { response, body };
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}
