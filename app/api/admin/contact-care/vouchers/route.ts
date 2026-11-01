import { requireAdminRoute } from "@/lib/admin-route";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { CONTACT_CARE_UUID } from "@/lib/contact-care";
import { careJson, readCareJson } from "@/lib/contact-care-server";
import { parseContactVoucherGrant } from "@/lib/contact-care-grants";

const missing = (code?: string) => ["42P01", "PGRST202", "PGRST205"].includes(code ?? "");
function failure(error: unknown) {
  const e = error as { code?: string; message?: string };
  if (missing(e?.code)) return careJson({ error: "관리자 교환권 지급 SQL을 먼저 적용해 주세요. 기존 교환권은 그대로 유지돼요." }, 503);
  if (e?.message?.includes("CARE_GRANT_ADMIN")) return careJson({ error: "활성 관리자 계정만 지급할 수 있어요." }, 403);
  if (e?.message?.includes("CARE_GRANT_MEMBER_CHANGED")) return careJson({ error: "회원 상태 또는 닉네임이 바뀌어 지급하지 않았어요. 내역을 다시 확인해 주세요.", resetRequest: true }, 409);
  if (e?.message?.includes("CARE_GRANT_CONFLICT")) return careJson({ error: "이전 지급 요청과 입력 내용이 달라요. 새로 지급하지 말고 이력을 확인해 주세요." }, 409);
  console.error("[admin-contact-vouchers] request failed", e?.code ?? "unknown");
  return careJson({ error: "처리 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요. 중복 지급되지는 않아요." }, 500);
}
export async function GET(req: Request) {
  try {
    const auth = await requireAdminRoute();
    if (!auth.ok) return auth.response;
    const userId = new URL(req.url).searchParams.get("userId");
    if (!userId || !CONTACT_CARE_UUID.test(userId)) return careJson({ error: "조회할 회원을 선택해 주세요." }, 400);
    const profile = await auth.admin.from("profiles").select("user_id,nickname,phone_verified,is_banned").eq("user_id", userId).maybeSingle();
    if (profile.error) throw profile.error;
    if (!profile.data) return careJson({ error: "회원을 찾지 못했어요." }, 404);
    const [manual, claims, history, installed, account] = await Promise.all([
      auth.admin.from("contact_care_manual_vouchers").select("id", { count: "exact", head: true }).eq("user_id", userId).is("used_at", null).is("revoked_at", null),
      auth.admin.from("contact_care_claims").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "approved").is("used_at", null),
      auth.admin.from("contact_care_manual_vouchers").select("id,reason,created_at,used_at,revoked_at").eq("user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(20),
      auth.admin.from("contact_care_admin_grants").select("id").eq("user_id", userId).limit(1),
      auth.admin.auth.admin.getUserById(userId),
    ]);
    if (manual.error || claims.error || history.error || account.error) throw manual.error || claims.error || history.error || account.error;
    if (installed.error && !missing(installed.error.code)) throw installed.error;
    if (![manual.count, claims.count].every(n => Number.isSafeInteger(n) && n! >= 0)) throw Error("INVALID_BALANCE");
    const member = account.data.user;
    const bannedUntil = member?.banned_until ? Date.parse(member.banned_until) : null;
    const canGrant = !!member && !member.deleted_at && profile.data.phone_verified === true && !profile.data.is_banned &&
      !!profile.data.nickname?.trim() && (bannedUntil === null || (Number.isFinite(bannedUntil) && bannedUntil <= Date.now()));
    return careJson({ member: { id: userId, nickname: profile.data.nickname || "회원", canGrant }, installed: !installed.error,
      manualRemaining: manual.count, claimRemaining: claims.count, remaining: manual.count! + claims.count!, history: history.data ?? [] });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  const origin = ensureAllowedMutationOrigin(req);
  if (origin) return origin;
  try {
    const auth = await requireAdminRoute();
    if (!auth.ok) return auth.response;
    let raw;
    try { raw = await readCareJson(req, 3000); } catch { return careJson({ error: "입력 내용을 확인해 주세요." }, 400); }
    const body = parseContactVoucherGrant(raw);
    if (!body) return careJson({ error: "회원·수량(1~10장)·지급 사유(5~300자)와 최종 확인이 필요해요." }, 400);
    const result = await auth.admin.rpc("grant_contact_care_manual", { p_admin: auth.user.id, p_user: body.userId,
      p_request: body.requestId, p_quantity: body.quantity, p_reason: body.reason, p_expected_nickname: body.expectedNickname });
    if (result.error) throw result.error;
    const data = result.data;
    if (data?.ok !== true || data.requestId !== body.requestId || data.quantity !== body.quantity || typeof data.alreadyGranted !== "boolean" ||
      !Number.isSafeInteger(data.remaining) || data.remaining < 0) throw Error("INVALID_GRANT_RESULT");
    return careJson(data);
  } catch (error) { return failure(error); }
}
