import type { SupabaseClient } from "@supabase/supabase-js";

export type ViewerSessionState = {
  status: "checking" | "authenticated" | "guest" | "error";
  userId: string | null;
};

export const VIEWER_SESSION_ERROR = "로그인 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.";

function isMissingSession(error: { name?: string; code?: string; status?: number }) {
  return error.name === "AuthSessionMissingError" || error.code === "session_not_found"
    || error.code === "user_not_found" || error.status === 401;
}

/** Read-only identity recovery. Auth events are hints, never authorization. */
export function createViewerSessionRecovery(options: {
  auth: Pick<SupabaseClient["auth"], "getUser" | "onAuthStateChange">;
  onState: (state: ViewerSessionState) => void;
  onIdentityChange: () => void;
  timeoutMs?: number;
  retryDelayMs?: number;
}) {
  let state: ViewerSessionState = { status: "checking", userId: null };
  let identity: string | null | undefined;
  let stopped = false;
  let generation = 0;
  let pending = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let subscription: { unsubscribe: () => void } | undefined;
  let lastRecoveryAt = 0;

  function publish(next: ViewerSessionState) {
    state = next;
    options.onState(next);
  }

  function cancelRead() {
    generation += 1;
    pending = false;
    clearTimeout(retryTimer);
    clearTimeout(timeoutTimer);
    retryTimer = undefined;
    timeoutTimer = undefined;
  }

  function changeIdentity(next: string | null) {
    if (identity !== undefined && identity !== next) {
      // Fail closed across accounts, including a late old-account response.
      stop();
      publish({ status: "checking", userId: null });
      options.onIdentityChange();
      return true;
    }
    identity = next;
    return false;
  }

  async function verify(attempt = 0) {
    if (stopped || pending) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    pending = true;
    lastRecoveryAt = Date.now();
    const current = ++generation;
    publish({ status: "checking", userId: null });
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => options.auth.getUser()),
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => reject(new Error("identity_timeout")), options.timeoutMs ?? 10_000);
        }),
      ]);
      if (stopped || current !== generation) return;
      if (response.error && !isMissingSession(response.error)) throw response.error;
      const user = response.error ? null : response.data.user;
      const next = user && !user.deleted_at ? user.id : null;
      if (next) {
        if (changeIdentity(next)) return;
      } else {
        // An invalid stored session must reach the guest UI, not a reload loop.
        identity = null;
      }
      publish({ status: next ? "authenticated" : "guest", userId: next });
    } catch {
      if (stopped || current !== generation) return;
      // A transport/5xx/rate-limit failure is not evidence of a logout.
      if (attempt === 0) {
        retryTimer = setTimeout(() => void verify(1), options.retryDelayMs ?? 800);
      } else {
        publish({ status: "error", userId: null });
      }
    } finally {
      if (current === generation) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
        pending = false;
      }
    }
  }

  function retry() {
    if (stopped || pending || state.status === "authenticated") return;
    void verify();
  }

  function recoverOnReturn() {
    if (state.status !== "error" || Date.now() - lastRecoveryAt < 5_000) return;
    retry();
  }

  function start() {
    if (stopped || subscription) return;
    const { data } = options.auth.onAuthStateChange((event, session) => {
      if (stopped) return;
      const next = session?.user.id ?? null;
      if (changeIdentity(next)) return;
      if (event === "SIGNED_OUT") {
        cancelRead();
        publish({ status: "guest", userId: null });
        return;
      }
      if (next && state.status !== "authenticated" && !pending && retryTimer === undefined) {
        // Never await another Auth method while Supabase holds its event lock.
        retryTimer = setTimeout(() => void verify(), 0);
      }
    });
    subscription = data.subscription;
    if (stopped) subscription.unsubscribe();
    void verify();
  }

  function stop() {
    stopped = true;
    cancelRead();
    subscription?.unsubscribe();
  }

  return { start, stop, retry, recoverOnReturn };
}
