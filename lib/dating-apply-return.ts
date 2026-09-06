// Only a local Open Card application route may be used after a credit purchase.
export function normalizeDatingApplyReturn(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\/community\/dating\/cards\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/apply(\?from=nearby)?$/i.exec(value);
  return match ? value : null;
}
