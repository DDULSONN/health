import { createClient } from "@/lib/supabase/server";

export type CertSummary = {
  user_id: string;
  total: number;
  is_verified: boolean;
};

export async function fetchUserCertSummaryMap(
  userIds: string[],
  supabaseClient?: Awaited<ReturnType<typeof createClient>>
) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const summaryMap = new Map<string, CertSummary>();
  if (ids.length === 0) return summaryMap;

  const supabase = supabaseClient ?? (await createClient());
  const { data, error } = await supabase
    .from("user_cert_summary")
    .select("user_id,total,is_verified")
    .in("user_id", ids)
    .eq("is_verified", true);

  if (error) {
    console.error("[fetchUserCertSummaryMap]", error.message);
    return summaryMap;
  }

  for (const row of data ?? []) {
    summaryMap.set(row.user_id as string, {
      user_id: row.user_id as string,
      total: Number(row.total ?? 0),
      is_verified: Boolean(row.is_verified),
    });
  }
  return summaryMap;
}
