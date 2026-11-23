type ApplyCreditStatus = { baseRemaining: number; creditsRemaining: number; passCreditsRemaining: number | null; total: number };

function isCreditCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// Presentation guards only. The existing application API remains authoritative.
export function readApplyCreditStatus(value: unknown): ApplyCreditStatus | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.loggedIn !== true || body.ok === false) return null;
  const { baseRemaining, creditsRemaining } = body;
  const passCreditsRemaining = body.passCreditsRemaining ?? null;
  if (!isCreditCount(baseRemaining) || !isCreditCount(creditsRemaining) ||
      (passCreditsRemaining !== null && !isCreditCount(passCreditsRemaining))) return null;
  const total = baseRemaining + creditsRemaining + (passCreditsRemaining ?? 0);
  return Number.isSafeInteger(total) ? { baseRemaining, creditsRemaining, passCreditsRemaining, total } : null;
}

export function readApplyCreditBalance(value: unknown): number | null {
  return readApplyCreditStatus(value)?.total ?? null;
}

export function readNearbyPurchaseCount(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const count = (value as Record<string, unknown>).newCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 30 ? count : null;
}
