import type { createAdminClient } from "@/lib/supabase/server";

export const TODAY_PROFILE_SOURCES = ["open_card", "paid_card", "one_on_one"] as const;
export type TodayProfileSource = typeof TODAY_PROFILE_SOURCES[number];
const TABLES = { open_card: "dating_cards", paid_card: "dating_paid_cards", one_on_one: "dating_1on1_cards" } as const;
export const TODAY_PROFILE_PAGE_SIZE = 20;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
type AdminClient = ReturnType<typeof createAdminClient>;
type Cursor = { version: 1; day: string; asOf: string; filter: string; source: TodayProfileSource; at: string | null; id: string | null };
export class TodayProfileInputError extends Error {}

export function koreaTodayRange(now = new Date()) {
  const day = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+09:00`);
  return { day, start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}

export function readTodayProfileCursor(raw: string | null, filter: string, now = new Date()): Cursor {
  const range = koreaTodayRange(now);
  if (filter !== "all" && !TODAY_PROFILE_SOURCES.includes(filter as TodayProfileSource)) throw new TodayProfileInputError("오늘 신규 목록은 프로필만 조회할 수 있습니다.");
  const first = filter === "all" ? TODAY_PROFILE_SOURCES[0] : filter as TodayProfileSource;
  if (!raw) return { version: 1, day: range.day, asOf: now.toISOString(), filter, source: first, at: null, id: null };
  if (raw.length > 1200) throw new TodayProfileInputError("목록 위치를 다시 확인해 주세요.");
  let cursor: Cursor;
  try { cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor; }
  catch { throw new TodayProfileInputError("목록 위치를 다시 확인해 주세요."); }
  if (!cursor || cursor.day !== range.day) throw new TodayProfileInputError("한국 날짜가 바뀌었습니다. 오늘 목록을 새로 불러와 주세요.");
  const asOf = Date.parse(cursor.asOf);
  const at = cursor.at === null ? null : Date.parse(cursor.at);
  if (cursor.version !== 1 || cursor.filter !== filter || !TODAY_PROFILE_SOURCES.includes(cursor.source)
    || (filter !== "all" && cursor.source !== filter) || !TIMESTAMP.test(cursor.asOf) || !Number.isFinite(asOf)
    || asOf < Date.parse(range.start) || asOf > now.getTime()
    || (cursor.at === null ? cursor.id !== null : !TIMESTAMP.test(cursor.at) || !Number.isFinite(at)
      || at! < Date.parse(range.start) || at! > asOf || !UUID.test(cursor.id ?? ""))) {
    throw new TodayProfileInputError("목록 위치가 올바르지 않습니다. 오늘 목록을 다시 불러와 주세요.");
  }
  return cursor;
}

// Stable keyset paging: a deletion/confirmation on a previous page cannot skip
// unreviewed profiles. New registrations are picked up by an explicit refresh.
export async function getTodayProfilePage(admin: AdminClient, filter: string, rawCursor: string | null, now = new Date()) {
  const cursor = readTodayProfileCursor(rawCursor, filter, now);
  const range = koreaTodayRange(now);
  const sources = filter === "all" ? [...TODAY_PROFILE_SOURCES] : [filter as TodayProfileSource];
  const counts = Object.fromEntries(await Promise.all(sources.map(async source => {
    const { count, error } = await admin.from(TABLES[source]).select("id", { count: "exact", head: true })
      .gte("created_at", range.start).lt("created_at", range.end).lte("created_at", cursor.asOf);
    if (error) throw error;
    return [source, count ?? 0];
  }))) as Partial<Record<TodayProfileSource, number>>;
  const refs: { source: TodayProfileSource; id: string }[] = [];
  let next: Cursor | null = null;
  for (let index = sources.indexOf(cursor.source); index < sources.length; index++) {
    const source = sources[index];
    const remaining = TODAY_PROFILE_PAGE_SIZE - refs.length;
    if (!remaining) { next = { ...cursor, source, at: null, id: null }; break; }
    let query = admin.from(TABLES[source]).select("id,created_at")
      .gte("created_at", range.start).lt("created_at", range.end).lte("created_at", cursor.asOf)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(remaining + 1);
    if (source === cursor.source && cursor.at && cursor.id) {
      // Only validated timestamps/UUIDs reach the PostgREST expression.
      query = query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
    }
    const { data, error } = await query;
    if (error) throw error; // Never label a partial/failed source as the complete daily list.
    const rows = (data ?? []) as { id: string; created_at: string }[];
    const page = rows.slice(0, remaining);
    refs.push(...page.map(row => ({ source, id: row.id })));
    if (rows.length > remaining) {
      const last = page[page.length - 1];
      next = { ...cursor, source, at: last.created_at, id: last.id };
      break;
    }
  }
  return { refs, day: range.day, asOf: cursor.asOf, counts, total: Object.values(counts).reduce((a, b) => a + b, 0),
    cursor: Buffer.from(JSON.stringify(cursor)).toString("base64url"),
    nextCursor: next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null };
}
