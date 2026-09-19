export const OPEN_CARDS_HOME_HREF = "/community/dating/cards?tab=open_cards";
export const ONE_ON_ONE_HOME_HREF = "/community/dating/cards?tab=one_on_one";

/** Navigation only: never changes profile or matching eligibility. */
export function isDatingHomePath(pathname: string) {
  return pathname === "/community/dating/cards";
}

export function isOneOnOneDestination(pathname: string, tab: string | null) {
  return (isDatingHomePath(pathname) && tab === "one_on_one") ||
    pathname === "/dating/1on1" || pathname.startsWith("/dating/1on1/");
}

export type MatchingView = "all" | "received" | "applied" | "one_on_one" | "quick";

/** Keep every record; only omit empty sections from the overview. */
export function showMatchingGroup(view: MatchingView, group: MatchingView, recordCount: number) {
  return view === "all" ? recordCount > 0 : view === group;
}
