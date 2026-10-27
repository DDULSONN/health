import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { CONTACT_CARE_UUID } from "@/lib/contact-care";
import { careJson, careError, careMatchNames, careManualBalance, CARE_CLAIM_FIELDS, readCareJson } from "@/lib/contact-care-server";
import { hashDatingContactBlockValue, normalizeDatingContactPhone } from "@/lib/dating-contact-blocks";
import { hashOneOnOneBlockedPhone } from "@/lib/dating-1on1-phone-blocks";
import { CARE_EVIDENCE_BUCKET, prepareCareEvidence, readCareForm } from "@/lib/contact-care-evidence";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return careJson({ error: "로그인이 필요해요." }, 401);
  const admin = createAdminClient();
  try {
    if (new URL(req.url).searchParams.get("summary") === "1") {
      const [claim, manual] = await Promise.all([
        admin.from("contact_care_claims").select("status,used_at").eq("user_id", user.id).maybeSingle(),
        careManualBalance(admin, user.id),
      ]);
      if (claim.error) throw claim.error;
      return careJson({ remaining: manual.remaining + (claim.data?.status === "approved" && !claim.data.used_at ? 1 : 0) });
    }
    const [policy, claim, manual] = await Promise.all([
      admin.from("contact_care_policy").select("enabled,starts_at").eq("id", true).maybeSingle(),
      admin.from("contact_care_claims").select(CARE_CLAIM_FIELDS).eq("user_id", user.id).maybeSingle(),
      careManualBalance(admin, user.id),
    ]);
    if (policy.error) throw policy.error;
    if (claim.error) throw claim.error;
    const active = policy.data?.enabled === true && Date.parse(policy.data.starts_at) <= Date.now();
    const result = { active, starts_at: policy.data?.starts_at ?? null, claim: claim.data,
      manual_remaining: manual.remaining, manual_history: [] as { used_match_id: string; used_at: string }[],
      payments: [] as { id: string; name?: string; order_id: string; exchanged_at: string }[], matches: [] as unknown[] };
    if (manual.installed) {
      const history = await admin.from("contact_care_manual_vouchers").select("used_match_id,used_at")
        .eq("user_id", user.id).not("used_at", "is", null).order("used_at", { ascending: false }).limit(10);
      if (history.error) throw history.error;
      result.manual_history = history.data ?? [];
    }
    if ((active && (!claim.data || claim.data.status === "rejected")) || claim.data?.status === "needs_info") {
      const orderQuery = admin.from("toss_test_payment_orders").select("id,product_ref_id,approved_at")
        .eq("user_id", user.id).eq("product_type", "one_on_one_contact_exchange").eq("status", "paid")
        .is("canceled_at", null).or("cancel_amount.is.null,cancel_amount.eq.0").gt("amount", 0)
        .not("approved_at", "is", null).order("approved_at", { ascending: false }).limit(50);
      // Eligibility runs from the actual exchange, not the feature launch date.
      // A requested supplement must stay reachable even after newer purchases.
      const orders = await (claim.data?.status === "needs_info" ? orderQuery.eq("id", claim.data.order_id) : orderQuery);
      if (orders.error) throw orders.error;
      const ids = [...new Set((orders.data ?? []).map(o => o.product_ref_id).filter(Boolean))];
      if (ids.length) {
        const matches = await admin.from("dating_1on1_match_proposals")
          .select("id,source_user_id,candidate_user_id,source_card_id,candidate_card_id,contact_exchange_approved_at")
          .in("id", ids).eq("contact_exchange_paid_by_user_id", user.id);
        if (matches.error) throw matches.error;
        const rows = (matches.data ?? []).filter(m => [m.source_user_id, m.candidate_user_id].includes(user.id) && m.contact_exchange_approved_at &&
          (claim.data?.status === "needs_info" ? claim.data.match_id === m.id && Date.parse(claim.data.supplement_due_at) >= Date.now() : Date.parse(m.contact_exchange_approved_at) + 72 * 3600000 >= Date.now()));
        const names = await careMatchNames(admin, rows, user.id);
        result.payments = rows.map(m => ({ id: m.id, name: names.get(m.id), order_id: orders.data!.find(o => o.product_ref_id === m.id)!.id, exchanged_at: m.contact_exchange_approved_at }));
      }
      const previous = claim.data;
      if (previous?.exchanged_at && !result.payments.some(m => m.id === previous.match_id) &&
        orders.data?.some(o => o.id === previous.order_id) &&
        (previous.status === "needs_info" ? Date.parse(previous.supplement_due_at) >= Date.now() : Date.parse(previous.exchanged_at) + 72 * 3600000 >= Date.now())) {
        result.payments.push({ id: previous.match_id, name: previous.counterparty_name || "상대 프로필", order_id: previous.order_id, exchanged_at: previous.exchanged_at });
      }
    }
    if (manual.remaining > 0 || claim.data?.status === "approved" && !claim.data.used_at) {
      const originalMatchId = claim.data?.match_id;
      const matches = await admin.from("dating_1on1_match_proposals")
        .select("id,source_user_id,source_card_id,candidate_card_id")
        .or(`source_user_id.eq.${user.id},candidate_user_id.eq.${user.id}`)
        .eq("state", "mutual_accepted").in("contact_exchange_status", ["none", "awaiting_applicant_payment"])
        .order("created_at", { ascending: false }).limit(30);
      if (matches.error) throw matches.error;
      const names = await careMatchNames(admin, matches.data ?? [], user.id);
      result.matches = (matches.data ?? []).filter(m => manual.remaining > 0 || m.id !== originalMatchId).map(m => ({ id: m.id, name: names.get(m.id) }));
    }
    return careJson(result);
  } catch (error) { return careError(error); }
}

export async function POST(req: Request) {
  const origin = ensureAllowedMutationOrigin(req);
  if (origin) return origin;
  const { user } = await getRequestAuthContext(req);
  if (!user) return careJson({ error: "로그인이 필요해요." }, 401);
  let body;
  let form: FormData | null = null;
  try {
    if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      form = await readCareForm(req);
      const raw = form.get("payload");
      if (typeof raw !== "string" || raw.length > 4000) return careJson({ error: "입력 내용을 확인해 주세요." }, 400);
      body = JSON.parse(raw);
    } else {
      body = await readCareJson(req, 4000);
    }
  } catch { return careJson({ error: "캡처는 1~3장, 합계 3MB 이하로 첨부해 주세요." }, 400); }
  if (!body || typeof body.matchId !== "string" || !CONTACT_CARE_UUID.test(body.matchId)) return careJson({ error: "매칭을 선택해 주세요." }, 400);
  const admin = createAdminClient();
  try {
    if (body.action === "apply") {
      if (!form || typeof body.orderId !== "string" || !CONTACT_CARE_UUID.test(body.orderId) || body.confirmed !== true ||
        !["no_response", "scam"].includes(body.reason) || (body.revision != null && (typeof body.revision !== "string" || !CONTACT_CARE_UUID.test(body.revision))) ||
        typeof body.firstContactAt !== "string" || !Number.isFinite(Date.parse(body.firstContactAt)) ||
        typeof body.explanation !== "string" || body.explanation.trim().length < 10 || body.explanation.length > 500) {
        return careJson({ error: "연락 시각·신청 사유와 확인 항목을 입력해 주세요." }, 400);
      }
      const firstMs = Date.parse(body.firstContactAt);
      if (firstMs > Date.now() || (body.reason === "no_response" && firstMs > Date.now() - 24 * 3600000)) return careError(new Error("CARE_WAIT"));
      const reservation = await admin.rpc("reserve_contact_care_upload", { p_user: user.id, p_match: body.matchId, p_order: body.orderId, p_count: form.getAll("evidence").length });
      if (reservation.error) throw reservation.error;
      let images: Buffer[];
      try { images = await prepareCareEvidence(form); }
      catch { return careJson({ error: "캡처 파일을 읽을 수 없어요. JPG·PNG·WebP 캡처 1~3장, 합계 3MB 이하로 선택해 주세요." }, 400); }
      for (let i = 0; i < images.length; i++) {
        const uploaded = await admin.storage.from(CARE_EVIDENCE_BUCKET).upload(reservation.data.paths[i], images[i], { contentType: "image/webp", upsert: false, cacheControl: "0" });
        if (uploaded.error) throw new Error("CARE_UPLOAD");
      }
      // Never delete on an ambiguous response: SQL may have committed. Admin cleanup
      // only removes unsubmitted reservations after 24h, under the same row lock.
      const res = await admin.rpc("submit_contact_care", { p_user: user.id, p_match: body.matchId, p_order: body.orderId,
        p_first: new Date(body.firstContactAt).toISOString(), p_explanation: body.explanation.trim(), p_reason: body.reason, p_upload: reservation.data.id, p_revision: body.revision ?? null });
      if (res.error) throw res.error;
      return careJson(res.data);
    }
    if (!["redeem", "redeem_manual"].includes(body.action) || body.confirmed !== true) return careJson({ error: "교환권 사용을 확인해 주세요." }, 400);
    const match = await admin.from("dating_1on1_match_proposals").select("source_user_id,candidate_user_id").eq("id", body.matchId).maybeSingle();
    if (match.error) throw match.error;
    if (!match.data || ![match.data.source_user_id, match.data.candidate_user_id].includes(user.id)) return careJson({ error: "해당 매칭을 이용할 수 없어요." }, 404);
    const ids = [match.data.source_user_id, match.data.candidate_user_id];
    const profiles = await admin.from("profiles").select("user_id,phone_e164").in("user_id", ids);
    if (profiles.error) throw profiles.error;
    const phones = ids.map(id => normalizeDatingContactPhone(profiles.data?.find(p => p.user_id === id)?.phone_e164 ?? ""));
    if (phones.some(p => !p)) return careJson({ error: "휴대폰 인증 상태를 확인해 주세요. 교환권은 유지돼요." }, 409);
    const res = await admin.rpc(body.action === "redeem_manual" ? "redeem_contact_care_manual" : "redeem_contact_care", { p_user: user.id, p_match: body.matchId, p_phones: phones,
      p_contact_hashes: phones.map(p => hashDatingContactBlockValue("phone", p)), p_legacy_hashes: phones.map(hashOneOnOneBlockedPhone) });
    if (res.error) throw res.error;
    return careJson(res.data);
  } catch (error) { return careError(error); }
}
