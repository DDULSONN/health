// Only this optional relation may be missing during a staged deployment.
export function isSwipeDismissalsSchemaMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: string; message?: string };
  return (code === "42P01" || code === "PGRST205") &&
    String(message ?? "").includes("dating_swipe_incoming_dismissals");
}

export function swipeDismissalVersionKey(swipeId: string, createdAt: string): string {
  // Both values come from PostgreSQL timestamptz JSON output, including microseconds.
  return `${swipeId}:${createdAt}`;
}
