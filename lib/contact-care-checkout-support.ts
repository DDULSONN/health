import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTACT_CARE_UUID } from "@/lib/contact-care";
import { careJson } from "@/lib/contact-care-server";

export const CARE_CHECKOUT_SUPPORT_REASONS = ["checkout_pending", "payment_history", "multiple_orders"] as const;

export function isCareCheckoutSupportUnavailable(code?: string) {
  return ["42P01", "42883", "PGRST202", "PGRST205"].includes(code ?? "");
}

export async function requestCareCheckoutSupport(admin: SupabaseClient, userId: string, matchId: string) {
  const result = await admin.rpc("request_contact_care_checkout_support", { p_user: userId, p_match: matchId });
  const e = result.error;
  if (e) {
    if (isCareCheckoutSupportUnavailable(e.code)) {
      return careJson({ code: "CARE_SUPPORT_UNAVAILABLE", error: "지금은 화면에서 요청할 수 없어요. 고객센터에 문의해 주세요. 교환권은 유지돼요." }, 503);
    }
    if (e.message === "CARE_SUPPORT_MATCH") {
      return careJson({ code: "CARE_SUPPORT_NOT_BLOCKED", error: "해당 매칭을 이용할 수 없어요. 교환 내역을 다시 확인해 주세요." }, 404);
    }
    if (["CARE_SUPPORT_NOT_BLOCKED", "CARE_SUPPORT_NO_CREDIT"].includes(e.message)) {
      return careJson({ code: "CARE_SUPPORT_NOT_BLOCKED", error: "교환권 또는 결제 상태가 바뀌었어요. 내역을 다시 확인해 주세요." }, 409);
    }
    if (e.message === "CARE_SUPPORT_LIMIT") {
      return careJson({ code: "CARE_SUPPORT_LIMIT", error: "오늘 요청 가능한 횟수를 모두 썼어요. 추가 확인은 고객센터에 문의해 주세요." }, 429);
    }
  }
  const data = result.data;
  if (e || data?.ok !== true || typeof data.supportReference !== "string" || !CONTACT_CARE_UUID.test(data.supportReference) ||
    typeof data.alreadyRequested !== "boolean" || typeof data.alreadyResolved !== "boolean" ||
    (data.alreadyResolved && !data.alreadyRequested)) {
    console.error("[contact-care-checkout-support] request unavailable", e?.code ?? "invalid_result");
    return careJson({ code: "CARE_SUPPORT_UNAVAILABLE", error: "접수 결과를 확인하지 못했어요. 같은 매칭에서 다시 요청해도 중복 접수되지 않아요." }, 503);
  }
  return careJson({ ok: true, supportReference: data.supportReference, alreadyRequested: data.alreadyRequested, alreadyResolved: data.alreadyResolved });
}
