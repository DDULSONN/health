// Optional reads must not prevent independent card/profile reads from succeeding.
export async function readDatingJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as T : null;
  } catch {
    return null;
  }
}
