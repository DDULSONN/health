import type { SupabaseClient } from "@supabase/supabase-js";
import { parseDatingBirthYear } from "@/lib/dating-age";
import { normalizeDatingContactPhone } from "@/lib/dating-contact-blocks";
import { isExpansionEnabled } from "@/lib/dating-1on1-expansion";

export const EXPANSION_MAIL = {
  key: "one-on-one-candidate-expansion-2026-10-10",
  campaign: "one_on_one_outreach",
  subject: "(광고) 짐툴 1:1, 하루 최대 3명의 후보를 더 확인해 보세요",
  body: [
    "안녕하세요, 짐툴입니다.", "",
    "1:1 매칭에 ‘후보 넓혀보기’가 추가됐어요.", "",
    "기존 추천 후보와 오늘의 추가 후보는 그대로 두고, 하루 최대 3명을 더 확인할 수 있어요.",
    "나이 조건은 유지하면서 가까운 지역부터 주변 지역까지 살펴봐요.",
    "후보 넓혀보기는 무료이며, 기존 후보 새로고침 횟수는 차감되지 않아요.", "",
    "1:1 매칭 탭에서 ‘후보 넓혀보기’를 눌러주세요.",
    "https://helchang.com/community/dating/cards?tab=one_on_one", "",
    "조건에 맞는 후보 수에 따라 3명보다 적게 표시될 수 있어요. 같은 날에는 다시 눌러도 새 후보가 추가되지 않아요.",
    "기존 매칭과 연락처 교환 방식은 바뀌지 않으며, 연락처 교환에는 별도의 비용이 발생합니다.", "",
    "감사합니다. 짐툴 드림",
  ].join("\n"),
} as const;

/** Consent/opt-out is checked separately, both at queue time and immediately before delivery. */
export async function isExpansionMailRecipient(admin: SupabaseClient, userId: string, email: string): Promise<boolean> {
  if (!userId || !isExpansionEnabled(userId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return false;
  const [one, profile, auth] = await Promise.all([
    admin.from("dating_1on1_cards").select("birth_year").eq("user_id", userId)
      .in("status", ["submitted", "reviewing", "approved"])
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
    admin.from("profiles").select("role,is_banned,phone_e164").eq("user_id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  if (one.error || profile.error || auth.error) return false;
  const user = auth.data.user as (typeof auth.data.user & { deleted_at?: string | null; banned_until?: string | null });
  return Boolean(one.data?.length && parseDatingBirthYear(one.data[0].birth_year) !== null &&
    profile.data && profile.data.role !== "admin" && profile.data.is_banned !== true &&
    normalizeDatingContactPhone(String(profile.data.phone_e164 ?? "")) &&
    user?.id === userId && !user.deleted_at && user.email_confirmed_at &&
    (!user.banned_until || Date.parse(user.banned_until) <= Date.now()) &&
    user.email?.trim().toLowerCase() === email.trim().toLowerCase());
}
