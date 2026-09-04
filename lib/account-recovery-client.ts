export type AccountRecoveryCheck = {
  ok: boolean;
  code: string;
};

const RETRYABLE_STATUSES = new Set([401, 500, 502, 503, 504]);

export async function checkAccountRecoverySession(): Promise<AccountRecoveryCheck> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/account-recovery/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; code?: string };
      if (response.ok && body.ok === true) return { ok: true, code: "" };
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === 1) {
        return { ok: false, code: body.code ?? "RECOVERY_CHECK_FAILED" };
      }
    } catch {
      if (attempt === 1) return { ok: false, code: "RECOVERY_CHECK_FAILED" };
    }

    await new Promise((resolve) => window.setTimeout(resolve, 200));
  }

  return { ok: false, code: "RECOVERY_CHECK_FAILED" };
}
