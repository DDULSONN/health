import type { createAdminClient } from "@/lib/supabase/server";
import { promotePendingCardsBySex } from "@/lib/dating-cards-queue";

type Admin = ReturnType<typeof createAdminClient>;

export async function hideBannedMemberDatingCards(admin: Admin, userId: string, nowIso: string) {
  const [openCards, paidCards, oneOnOneCards] = await Promise.allSettled([
    admin.from("dating_cards").update({ status: "hidden", expires_at: nowIso })
      .eq("owner_user_id", userId).in("status", ["pending", "public"]).select("id,sex"),
    admin.from("dating_paid_cards").update({ status: "expired", expires_at: nowIso })
      .eq("user_id", userId).in("status", ["pending", "approved"]).select("id"),
    admin.from("dating_1on1_cards").update({ status: "rejected", updated_at: nowIso })
      .eq("user_id", userId).in("status", ["submitted", "reviewing", "approved"]).select("id"),
  ]);
  const okData = <T>(result: PromiseSettledResult<{ data: T | null; error: unknown }>) =>
    result.status === "fulfilled" && !result.value.error ? result.value.data : null;
  const open = okData(openCards);
  const paid = okData(paidCards);
  const oneOnOne = okData(oneOnOneCards);
  const vacatedSexes = [...new Set((open ?? []).map((row) => row.sex)
    .filter((value): value is "male" | "female" => value === "male" || value === "female"))];
  await Promise.allSettled(vacatedSexes.map((sex) => promotePendingCardsBySex(admin, sex)));
  return {
    hiddenOpenCards: open?.length ?? 0,
    hiddenPaidCards: paid?.length ?? 0,
    hiddenOneOnOneCards: oneOnOne?.length ?? 0,
    cardCleanupFailed: !open || !paid || !oneOnOne,
  };
}
