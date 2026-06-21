import { ensureCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type OneOnOneCardRow = {
  id: string;
  user_id: string | null;
  status: string | null;
  name: string | null;
  job: string | null;
  region: string | null;
  intro_text: string | null;
  strengths_text: string | null;
  preferred_partner_text: string | null;
  created_at: string | null;
};

type SuspicionLevel = "clear" | "medium" | "high";

const MAX_SCAN_PER_RUN = 1000;
const ACTIVE_STATUSES = ["submitted", "reviewing", "approved"];

const DIRECT_CONTACT_PATTERNS: Array<{ label: string; level: SuspicionLevel; pattern: RegExp }> = [
  {
    label: "휴대폰 번호 직접 기재 의심",
    level: "high",
    pattern: /(?:010|011|016|017|018|019)[-\s.)]*(?:\d[-\s.]*){7,8}/i,
  },
  {
    label: "카카오톡/카톡 ID 기재 의심",
    level: "high",
    pattern: /(카\s*톡|카\s*카\s*오|ㅋ\s*ㅌ|오\s*픈\s*(카\s*톡|채\s*팅)|오카|옾챗|오픈채팅|open\s*(kakao|chat)|kakao|kakaotalk).{0,24}(아이디|id|검색|추가|친추|연락|주세요|주세용|보내|dm|디엠|@|[A-Za-z0-9._-]{3,})/i,
  },
  {
    label: "인스타 계정/DM 유도 의심",
    level: "high",
    pattern: /(인\s*스\s*타|인별|instagram|insta|ig|디엠|dm).{0,24}(아이디|id|계정|검색|팔로우|연락|주세요|주세용|보내|@|[A-Za-z0-9._-]{3,})/i,
  },
  {
    label: "외부 메신저 ID 기재 의심",
    level: "high",
    pattern: /(라인|line|텔레그램|telegram|텔레)\s*[:：]?\s*[A-Za-z0-9._-]{2,}/i,
  },
  {
    label: "외부 링크/오픈채팅 링크 의심",
    level: "high",
    pattern: /https?:\/\/|www\.|open\.kakao|t\.me|instagram\.com|linktr\.ee|bit\.ly/i,
  },
  {
    label: "SNS 핸들 기재 의심",
    level: "medium",
    pattern: /(^|[^A-Za-z0-9._])@[A-Za-z0-9._]{3,}/i,
  },
  {
    label: "앱 밖 연락 유도 문구 의심",
    level: "medium",
    pattern: /(연락처|연락|번호|전화|문자|카톡|카카오|인스타|dm|디엠).{0,18}(주세요|주세용|가능|해요|할게|남겨|교환|보내|알려)/i,
  },
  {
    label: "외부 계정 ID 직접 기재 의심",
    level: "high",
    pattern: /(아이디|id|계정)\s*(은|는|:|：|=)?\s*[A-Za-z0-9._-]{3,}/i,
  },
  {
    label: "핸들로 외부 연락 유도 의심",
    level: "high",
    pattern: /[A-Za-z0-9][A-Za-z0-9._-]{2,}\s*(으로|로|여기로|쪽으로).{0,12}(연락|dm|디엠|보내|주세요|주세용)/i,
  },
  {
    label: "DM/디엠 요청 의심",
    level: "medium",
    pattern: /(dm|디엠|메시지|쪽지).{0,16}(주세요|주세용|보내|가능|환영|해요|해주)/i,
  },
  {
    label: "우회 표기 외부 계정 의심",
    level: "high",
    pattern: /(카\s*톡|카\s*카\s*오|ㅋ\s*ㅌ|오카|옾챗|인\s*스\s*타|인별|insta|instagram|ig)\s*[A-Za-z0-9._-]{3,}/i,
  },
];

function cleanText(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function buildReviewText(card: OneOnOneCardRow) {
  return [
    card.name,
    card.job,
    card.region,
    card.intro_text,
    card.strengths_text,
    card.preferred_partner_text,
  ]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join("\n");
}

function reviewCard(card: OneOnOneCardRow) {
  const merged = buildReviewText(card);
  const matched = DIRECT_CONTACT_PATTERNS.filter((item) => item.pattern.test(merged));
  const flags = Array.from(new Set(matched.map((item) => item.label)));
  const suspicionLevel: SuspicionLevel =
    matched.some((item) => item.level === "high") ? "high" : flags.length > 0 ? "medium" : "clear";

  return {
    suspicionLevel,
    flags,
    summary:
      suspicionLevel === "clear"
        ? "1대1 카드 자동 검수: 외부 연락처 의심 없음"
        : `1대1 카드 자동 검수: ${flags.join(", ")}`,
    raw: {
      provider: "rules_cron",
      rule: "dating_1on1_direct_contact",
      scanned_text_fields: ["name", "job", "region", "intro_text", "strengths_text", "preferred_partner_text"],
      matched_flags: flags,
    },
  };
}

export async function GET(req: Request) {
  const unauthorized = ensureCronAuthorized(req);
  if (unauthorized) return unauthorized;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("dating_1on1_cards")
    .select("id,user_id,status,name,job,region,intro_text,strengths_text,preferred_partner_text,created_at")
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(MAX_SCAN_PER_RUN);

  if (error) {
    console.error("[cron dating-1on1-card-review] cards query failed", error);
    return NextResponse.json({ ok: false, error: "cards_query_failed", detail: error.message }, { status: 500 });
  }

  const cards = ((data ?? []) as OneOnOneCardRow[]).filter((card) => cleanText(card.id));
  const now = new Date().toISOString();
  const rows = cards.flatMap((card) => {
    const review = reviewCard(card);
    return ["one_on_one", "one_on_one_application"].map((sourceType) => ({
      source_type: sourceType,
      card_id: card.id,
      user_id: card.user_id,
      card_status: card.status,
      display_name: card.name,
      suspicion_level: review.suspicionLevel,
      flags: review.flags,
      summary: review.summary,
      photo_flags: [],
      text_flags: review.flags,
      raw_result: review.raw,
      scanned_at: now,
      admin_user_id: null,
    }));
  });

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, suspicious: 0 });
  }

  const upsertRes = await admin.from("admin_dating_card_ai_reviews").upsert(rows, {
    onConflict: "source_type,card_id",
  });

  if (upsertRes.error) {
    console.error("[cron dating-1on1-card-review] review upsert failed", upsertRes.error);
    return NextResponse.json({ ok: false, error: "review_upsert_failed", detail: upsertRes.error.message }, { status: 500 });
  }

  const suspicious = rows.filter((row) => row.suspicion_level === "medium" || row.suspicion_level === "high").length;
  return NextResponse.json({
    ok: true,
    scanned: cards.length,
    reviewRows: rows.length,
    suspicious,
    scannedAt: now,
  });
}
