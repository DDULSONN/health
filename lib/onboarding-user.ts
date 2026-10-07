import type { SupabaseClient } from "@supabase/supabase-js";

/** Read-only: transient failures must not send a signed-in member back to login. */
export async function readOnboardingUser(
  auth: Pick<SupabaseClient["auth"], "getUser">,
  options: { signal: AbortSignal; timeoutMs?: number; retryDelayMs?: number },
) {
  const { signal } = options;
  const aborted = () => new DOMException("Onboarding check cancelled", "AbortError");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal.aborted) throw aborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => auth.getUser()),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(aborted());
          signal.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(() => reject(new Error("identity_timeout")), options.timeoutMs ?? 10_000);
        }),
      ]);
      if (signal.aborted) throw aborted();
      const error = response.error;
      if (error) {
        if (error.name === "AuthSessionMissingError" || error.code === "session_not_found"
          || error.code === "user_not_found" || error.status === 401) return null;
        throw error;
      }
      return response.data.user?.deleted_at ? null : response.data.user;
    } catch (error) {
      if (signal.aborted) throw aborted();
      if (attempt === 1) throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(delay);
        signal.removeEventListener("abort", cancel);
        reject(aborted());
      };
      const delay = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        resolve();
      }, options.retryDelayMs ?? 800);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  throw new Error("identity_unavailable");
}
