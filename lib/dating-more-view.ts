export type CardSex = "male" | "female";

export function normalizeCardSex(value: unknown): CardSex | null {
  if (value === "male" || value === "female") return value;
  return null;
}

export async function hasMoreViewAccess(
  adminClient: { from: (table: string) => any },
  userId: string,
  sex: CardSex
): Promise<boolean> {
  const res = await adminClient
    .from("dating_more_view_requests")
    .select("id")
    .eq("user_id", userId)
    .eq("sex", sex)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();

  return Boolean(res.data) && !res.error;
}

export async function getMoreViewStatusBySex(
  adminClient: { from: (table: string) => any },
  userId: string
): Promise<Record<CardSex, "none" | "pending" | "approved" | "rejected">> {
  const out: Record<CardSex, "none" | "pending" | "approved" | "rejected"> = {
    male: "none",
    female: "none",
  };

  const res = await adminClient
    .from("dating_more_view_requests")
    .select("sex,status,created_at")
    .eq("user_id", userId)
    .in("sex", ["male", "female"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (res.error || !Array.isArray(res.data)) return out;

  for (const row of res.data as Array<{ sex: string; status: string }>) {
    const sex = normalizeCardSex(row.sex);
    if (!sex) continue;
    if (out[sex] !== "none") continue;
    const status = row.status;
    if (status === "pending" || status === "approved" || status === "rejected") {
      out[sex] = status;
    }
  }

  return out;
}
