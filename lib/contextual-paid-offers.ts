// Presentation guards only. The existing checkout API remains authoritative.
export function readApplyCreditBalance(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.loggedIn !== true || body.ok === false) return null;
  const base = body.baseRemaining, extra = body.creditsRemaining;
  if (typeof base !== "number" || typeof extra !== "number" ||
      !Number.isSafeInteger(base) || !Number.isSafeInteger(extra) || base < 0 || extra < 0) return null;
  return Number.isSafeInteger(base + extra) ? base + extra : null;
}

export function readNearbyPurchaseCount(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const count = (value as Record<string, unknown>).newCount;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 30 ? count : null;
}
