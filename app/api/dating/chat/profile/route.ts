import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveDatingChatConnection, type DatingChatSourceKind } from "@/lib/dating-chat";
import { hasDatingBlockBetween } from "@/lib/dating-blocks";
import { hasDatingContactBlockBetween } from "@/lib/dating-contact-blocks";
import { buildSignedImageUrl, buildSignedImageUrlAllowRaw, extractStorageObjectPathFromBuckets, withImageTransform } from "@/lib/images";
import type { ChatPeerProfile } from "@/lib/chat-peer-profile";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const unavailable = () => json({ ok: false, message: "현재 확인할 수 없는 프로필입니다. 연결이 취소되었거나 프로필이 삭제됐을 수 있어요." }, 404);
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

function photos(row: Record<string, unknown>, application: boolean) {
  const bucket = application ? "dating-apply-photos" : "dating-card-photos";
  // Accepted applicants were already visible to the card owner. Card photos keep their blur setting.
  const unblurred = application || row.photo_visibility === "public";
  const values = unblurred ? row.photo_paths : Array.isArray(row.blur_paths) && row.blur_paths.length ? row.blur_paths : [row.blur_thumb_path];
  return (Array.isArray(values) ? values : []).slice(0, 2).flatMap(value => {
    try {
      const path = extractStorageObjectPathFromBuckets(value, [bucket, "dating-photos"]);
      if (!path || path.includes("..") || (!unblurred && path.includes("/raw/"))) return [];
      const url = unblurred ? buildSignedImageUrlAllowRaw(bucket, path) : buildSignedImageUrl(bucket, path);
      return url ? [withImageTransform(url, { width: 640, quality: 70 })!] : [];
    } catch { return []; }
  });
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) return json({ ok: false, message: "로그인이 필요합니다." }, 401);
  const params = new URL(req.url).searchParams;
  const threadId = params.get("thread_id") ?? "";
  let sourceKind = params.get("source_kind") ?? "";
  let sourceId = params.get("source_id") ?? "";
  if (threadId ? !UUID.test(threadId) : !UUID.test(sourceId) || !["open", "paid", "swipe"].includes(sourceKind)) {
    return json({ ok: false, message: "채팅 연결 정보를 확인해 주세요." }, 400);
  }
  const admin = createAdminClient();
  try {
    let threadQuery = admin.from("dating_chat_threads")
      .select("id,source_kind,source_id,user_a_id,user_b_id,status,user_a_hidden_at,user_b_hidden_at");
    threadQuery = threadId ? threadQuery.eq("id", threadId) : threadQuery.eq("source_kind", sourceKind).eq("source_id", sourceId);
    const threadRes = await threadQuery.maybeSingle();
    if (threadRes.error) throw threadRes.error;
    const thread = threadRes.data;
    if (threadId && !thread) return unavailable();
    if (thread) {
      if ((thread.user_a_id !== user.id && thread.user_b_id !== user.id) || thread.status !== "open" ||
        (thread.user_a_id === user.id ? thread.user_a_hidden_at : thread.user_b_hidden_at)) return unavailable();
      sourceKind = thread.source_kind; sourceId = thread.source_id;
    }
    if (!["open", "paid", "swipe"].includes(sourceKind)) return unavailable();
    const connection = await resolveDatingChatConnection(admin, user.id, sourceKind as DatingChatSourceKind, sourceId);
    if (!connection || connection.peerUserId === user.id) return unavailable();
    if (thread && (thread.user_a_id === user.id ? thread.user_b_id : thread.user_a_id) !== connection.peerUserId) return unavailable();
    const peerId = connection.peerUserId;
    const [members, blocked, contactBlocked] = await Promise.all([
      admin.from("profiles").select("user_id,is_banned").in("user_id", [user.id, peerId]),
      hasDatingBlockBetween(admin, user.id, peerId),
      hasDatingContactBlockBetween(admin, user.id, peerId),
    ]);
    if (members.error) throw members.error;
    if (blocked || contactBlocked || [user.id, peerId].some(id => !members.data?.some(row => row.user_id === id && row.is_banned !== true))) return unavailable();

    let row: Record<string, unknown> | null = null;
    let application = false;
    const common = "age,region,height_cm,job,training_years,intro_text";
    if (sourceKind === "open" || sourceKind === "paid") {
      const paid = sourceKind === "paid";
      const cardKey = paid ? "paid_card_id" : "card_id";
      const appRes = await admin.from(paid ? "dating_paid_card_applications" : "dating_card_applications")
        .select(`id,${cardKey},applicant_user_id,status`).eq("id", sourceId).eq("status", "accepted").maybeSingle();
      if (appRes.error) throw appRes.error;
      const app = appRes.data as Record<string, unknown> | null;
      if (!app) return unavailable();
      if (app.applicant_user_id === peerId) {
        application = true;
        const result = await admin.from(paid ? "dating_paid_card_applications" : "dating_card_applications")
          .select(`applicant_display_nickname,${common},photo_paths`).eq("id", sourceId).eq("status", "accepted").eq("applicant_user_id", peerId).maybeSingle();
        if (result.error) throw result.error;
        row = result.data as unknown as Record<string, unknown> | null;
      } else {
        if (app.applicant_user_id !== user.id) return unavailable();
        const result = await admin.from(paid ? "dating_paid_cards" : "dating_cards")
          .select(paid ? `nickname,${common},strengths_text,ideal_text,photo_visibility,photo_paths,blur_thumb_path,status,expires_at` : `display_nickname,${common},strengths_text,ideal_type,photo_visibility,photo_paths,blur_paths,blur_thumb_path,status`)
          .eq("id", String(app[cardKey])).eq(paid ? "user_id" : "owner_user_id", peerId).maybeSingle();
        if (result.error) throw result.error;
        row = result.data as unknown as Record<string, unknown> | null;
      }
    } else {
      const matchRes = await admin.from("dating_card_swipe_matches").select("id,user_a_id,user_b_id,user_a_card_id,user_b_card_id").eq("id", sourceId).maybeSingle();
      if (matchRes.error) throw matchRes.error;
      const match = matchRes.data;
      if (!match || ![match.user_a_id, match.user_b_id].includes(user.id) || ![match.user_a_id, match.user_b_id].includes(peerId)) return unavailable();
      const result = await admin.from("dating_cards")
        .select(`display_nickname,${common},strengths_text,ideal_type,photo_visibility,photo_paths,blur_paths,blur_thumb_path,status`)
        .eq("id", match.user_a_id === peerId ? match.user_a_card_id : match.user_b_card_id).eq("owner_user_id", peerId).maybeSingle();
      if (result.error) throw result.error;
      row = result.data;
    }
    if (!row || row.status === "rejected") return unavailable();
    const photosAllowed = application || sourceKind !== "paid" ||
      (row.status === "approved" && typeof row.expires_at === "string" && Date.parse(row.expires_at) > Date.now());
    // Explicit presentation whitelist: no phone, email, Instagram, storage paths or unrelated profiles.
    const profile: ChatPeerProfile = {
      name: text(row.applicant_display_nickname) ?? text(row.display_nickname) ?? text(row.nickname) ?? connection.peerNickname,
      age: number(row.age), height_cm: number(row.height_cm), training_years: number(row.training_years),
      region: text(row.region), job: text(row.job), intro_text: text(row.intro_text),
      strengths_text: text(row.strengths_text), ideal_type: text(row.ideal_type) ?? text(row.ideal_text), photo_urls: photosAllowed ? photos(row, application) : [],
    };
    return json({ ok: true, profile });
  } catch (error) {
    console.error("[GET /api/dating/chat/profile] failed", error);
    return json({ ok: false, message: "프로필을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." }, 500);
  }
}
