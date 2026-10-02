import type { SupabaseClient } from "@supabase/supabase-js";

export const PROFILE_REUSE_MAIL = {
  key: "open-card-profile-reuse-2026-10-02",
  campaign: "one_on_one_outreach",
  subject: "(광고) 짐툴, 오픈카드 내용으로 1:1 프로필을 더 쉽게 작성해요",
  body: [
    "안녕하세요, 짐툴입니다.",
    "",
    "오픈카드는 등록했지만 1:1 프로필은 아직 작성하지 않은 회원님께 개선된 작성 기능을 안내드려요.",
    "",
    "이제 오픈카드에 등록한 사진·지역·키·직업·강점·이상형을 가져와 1:1 프로필의 빈 항목을 채울 수 있어요.",
    "이름·출생연도·자기소개와 나머지 항목을 확인하면 됩니다. 이미 작성한 내용과 선택한 사진은 덮어쓰지 않아요.",
    "",
    "1:1에서 작성을 시작하면 1:1만 기본으로 선택돼요. 기존 오픈카드의 내용이나 공개·대기 상태는 바뀌지 않으며, 확인과 동의를 마쳐야 1:1에 등록됩니다.",
    "",
    "사진을 가져오지 못할 때는 직접 선택해서 계속 작성할 수 있어요.",
    "프로필 등록은 무료이며, 연락처 교환 단계에는 별도의 비용이 발생합니다.",
    "등록한 1:1 프로필은 다른 회원의 추천 후보로도 표시될 수 있어요.",
    "",
    "1:1 프로필 작성하기",
    "https://helchang.com/onboarding/dating?target=one_on_one",
    "작성 화면에서 ‘오픈카드 내용 가져오기’를 눌러주세요.",
    "",
    "이용 중 불편한 점이나 궁금한 점은 gymtools.kr@gmail.com으로 알려주세요.",
    "감사합니다. 짐툴 드림",
  ].join("\n"),
};

/** Explicit opt-in is checked separately by the existing mail worker. Recheck this cohort at send time. */
export async function isOpenCardOnlyMailRecipient(admin: SupabaseClient, userId: string, email: string): Promise<boolean> {
  if (!userId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return false;
  const [open, one, profile, auth] = await Promise.all([
    admin.from("dating_cards").select("id").eq("owner_user_id", userId).in("status", ["pending", "public"]).limit(1),
    // Also exclude previously withdrawn/rejected 1:1 profiles, rather than treating them as never written.
    admin.from("dating_1on1_cards").select("id").eq("user_id", userId).limit(1),
    admin.from("profiles").select("role,is_banned").eq("user_id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  if (open.error || one.error || profile.error || auth.error) return false;
  const user = auth.data.user as (typeof auth.data.user & { deleted_at?: string | null; banned_until?: string | null });
  return Boolean(open.data?.length && !one.data?.length && profile.data && profile.data.role !== "admin" &&
    profile.data.is_banned !== true && user?.id === userId && !user.deleted_at && user.email_confirmed_at &&
    (!user.banned_until || Date.parse(user.banned_until) <= Date.now()) &&
    user.email?.trim().toLowerCase() === email.trim().toLowerCase());
}
