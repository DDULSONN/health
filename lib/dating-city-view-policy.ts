export const WEEKLY_CITY_VIEW_NOTE = "weekly open card benefit v2:10";
export const WEEKLY_CITY_VIEW_LIMIT = 10;
export function isWeeklyCityViewPreview(note: unknown) {
  return note === WEEKLY_CITY_VIEW_NOTE;
}
