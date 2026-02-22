export type CardSex = "male" | "female";

type MoreViewStatus = "none" | "pending" | "approved" | "rejected";

type ActiveGrant = {
  requestId: string;
  sex: CardSex;
  accessExpiresAt: string;
  snapshotCardIds: string[];
};

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseSnapshotCardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  const code = String(e.code ?? "");
  const message = String(e.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("column");
}

export function normalizeCardSex(value: unknown): CardSex | null {
  if (value === "male" || value === "female") return value;
  return null;
}

export async function getActiveMoreViewGrant(
  adminClient: { from: (table: string) => any },
  userId: string,
  sex: CardSex
): Promise<ActiveGrant | null> {
  const res = await adminClient
    .from("dating_more_view_requests")
    .select("id,sex,status,access_expires_at,snapshot_card_ids,reviewed_at,created_at")
    .eq("user_id", userId)
    .eq("sex", sex)
    .eq("status", "approved")
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (res.error) {
    if (!isMissingColumnError(res.error)) return null;

    const legacyRes = await adminClient
      .from("dating_more_view_requests")
      .select("id,sex,status")
      .eq("user_id", userId)
      .eq("sex", sex)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (legacyRes.error || !legacyRes.data) return null;

    const defaultExpires = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    return {
      requestId: legacyRes.data.id,
      sex,
      accessExpiresAt: defaultExpires,
      snapshotCardIds: [],
    };
  }

  const rows = Array.isArray(res.data) ? res.data : [];
  for (const row of rows) {
    const rowSex = normalizeCardSex((row as { sex?: unknown }).sex);
    if (!rowSex) continue;
    const expiresAtIso = normalizeIsoDate((row as { access_expires_at?: unknown }).access_expires_at);
    if (!expiresAtIso) continue;
    if (new Date(expiresAtIso).getTime() <= Date.now()) continue;

    return {
      requestId: String((row as { id?: unknown }).id ?? ""),
      sex: rowSex,
      accessExpiresAt: expiresAtIso,
      snapshotCardIds: parseSnapshotCardIds((row as { snapshot_card_ids?: unknown }).snapshot_card_ids),
    };
  }

  return null;
}

export async function hasMoreViewAccess(
  adminClient: { from: (table: string) => any },
  userId: string,
  sex: CardSex
): Promise<boolean> {
  const active = await getActiveMoreViewGrant(adminClient, userId, sex);
  return Boolean(active);
}

export async function getMoreViewStatusBySex(
  adminClient: { from: (table: string) => any },
  userId: string
): Promise<Record<CardSex, MoreViewStatus>> {
  const out: Record<CardSex, MoreViewStatus> = {
    male: "none",
    female: "none",
  };

  const res = await adminClient
    .from("dating_more_view_requests")
    .select("sex,status,created_at,access_expires_at")
    .eq("user_id", userId)
    .in("sex", ["male", "female"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (res.error) {
    if (!isMissingColumnError(res.error)) return out;

    const legacyRes = await adminClient
      .from("dating_more_view_requests")
      .select("sex,status,created_at")
      .eq("user_id", userId)
      .in("sex", ["male", "female"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (legacyRes.error || !Array.isArray(legacyRes.data)) return out;

    for (const row of legacyRes.data as Array<{ sex: string; status: string }>) {
      const sex = normalizeCardSex(row.sex);
      if (!sex) continue;
      if (out[sex] !== "none") continue;
      if (row.status === "pending" || row.status === "approved" || row.status === "rejected") {
        out[sex] = row.status;
      }
    }

    return out;
  }

  if (!Array.isArray(res.data)) return out;

  for (const row of res.data as Array<{ sex: string; status: string; access_expires_at: string | null }>) {
    const sex = normalizeCardSex(row.sex);
    if (!sex) continue;
    if (out[sex] !== "none") continue;

    if (row.status === "approved") {
      const expiresAtIso = normalizeIsoDate(row.access_expires_at);
      if (expiresAtIso && new Date(expiresAtIso).getTime() > Date.now()) {
        out[sex] = "approved";
      }
      continue;
    }

    if (row.status === "pending" || row.status === "rejected") {
      out[sex] = row.status;
    }
  }

  return out;
}
