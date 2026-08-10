import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import type { createAdminClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const PAGE_SIZE = 1000;
const MAX_SCAN_COUNT = 20000;
const REVIEW_WINDOW_DAYS = 30;
const USER_DELETED_TAG = "one_on_one_user_deleted";
const ACTIVE_STATUSES = new Set(["submitted", "reviewing", "approved"]);

const PHONE_PATTERN = /(?:010|011|016|017|018|019)[-\s.)]*(?:\d[-\s.]*){7,8}/i;
const LINK_PATTERN = /https?:\/\/|www\.|open\.kakao|t\.me|instagram\.com|linktr\.ee|bit\.ly/i;
const SOCIAL_PATTERN =
  /(카\s*톡|카\s*카\s*오|ㅋ\s*ㅌ|오\s*픈\s*(카\s*톡|채\s*팅)|오카|옾챗|kakao|인\s*스\s*타|인별|instagram|insta|\big\b|디엠|\bdm\b|텔레그램|telegram|라인|\bline\b)/i;
const LABELED_ID_PATTERN = /(아이디|\bid\b|계정)\s*(은|는|:|：|=)?\s*[A-Za-z0-9._-]{2,}/i;
const AT_HANDLE_PATTERN = /(^|[^A-Za-z0-9._])@[A-Za-z0-9._-]{2,}/i;
const BARE_HANDLE_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._-]{2,30}$/i;

type AdminClient = ReturnType<typeof createAdminClient>;

type OneOnOneCardRow = {
  id: string;
  user_id: string | null;
  status: string | null;
  name: string | null;
  birth_year: number | null;
  region: string | null;
  job: string | null;
  intro_text: string | null;
  strengths_text: string | null;
  preferred_partner_text: string | null;
  admin_tags: unknown;
  created_at: string | null;
  updated_at: string | null;
};

type ContactFinding = {
  cardId: string;
  field: "name" | "intro" | "strengths" | "preferredPartner";
  fieldLabel: string;
  value: string;
  flags: string[];
};

function cleanText(value: unknown, max = 1000) {
  return String(value ?? "").trim().replace(/\s{3,}/g, "  ").slice(0, max);
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 80)).filter(Boolean);
}

function reviewField(
  cardId: string,
  field: ContactFinding["field"],
  fieldLabel: string,
  rawValue: unknown
): ContactFinding | null {
  const value = cleanText(rawValue, 1200);
  if (!value) return null;

  const flags: string[] = [];
  if (PHONE_PATTERN.test(value)) flags.push("전화번호 의심");
  if (LINK_PATTERN.test(value)) flags.push("외부 링크 의심");
  if (SOCIAL_PATTERN.test(value)) flags.push("SNS·메신저 언급");
  if (LABELED_ID_PATTERN.test(value)) flags.push("외부 계정 ID 의심");
  if (AT_HANDLE_PATTERN.test(value)) flags.push("SNS 핸들 의심");

  const compact = value.replace(/\s+/g, "");
  if (
    BARE_HANDLE_PATTERN.test(compact) &&
    (compact.startsWith("@") || compact.includes("_") || compact.includes(".") || /[A-Za-z].*\d|\d.*[A-Za-z]/.test(compact))
  ) {
    flags.push("단독 외부 계정 형식 의심");
  }

  const uniqueFlags = Array.from(new Set(flags));
  if (uniqueFlags.length === 0) return null;
  return {
    cardId,
    field,
    fieldLabel,
    value: value.slice(0, 240),
    flags: uniqueFlags,
  };
}

function reviewCard(card: OneOnOneCardRow) {
  return [
    reviewField(card.id, "name", "이름", card.name),
    reviewField(card.id, "intro", "자기소개", card.intro_text),
    reviewField(card.id, "strengths", "강점", card.strengths_text),
    reviewField(card.id, "preferredPartner", "원하는 상대", card.preferred_partner_text),
  ].filter((item): item is ContactFinding => item !== null);
}

function contentFingerprint(card: OneOnOneCardRow) {
  const merged = [card.intro_text, card.strengths_text, card.preferred_partner_text]
    .map((value) => cleanText(value, 1500).toLowerCase().replace(/\s+/g, ""))
    .join("|");
  return merged.replace(/\|/g, "").length >= 20 ? merged : "";
}

async function loadRecentCards(admin: AdminClient) {
  const rows: OneOnOneCardRow[] = [];
  const cutoff = new Date(Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  while (rows.length < MAX_SCAN_COUNT) {
    const from = rows.length;
    const to = Math.min(from + PAGE_SIZE, MAX_SCAN_COUNT) - 1;
    const { data, error } = await admin
      .from("dating_1on1_cards")
      .select(
        "id,user_id,status,name,birth_year,region,job,intro_text,strengths_text,preferred_partner_text,admin_tags,created_at,updated_at"
      )
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const page = (data ?? []) as OneOnOneCardRow[];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return rows;
}

export async function GET() {
  const guard = await requireAdminRoute();
  if (!guard.ok) return guard.response;

  try {
    const cards = await loadRecentCards(guard.admin);
    const cardsByUser = new Map<string, OneOnOneCardRow[]>();
    for (const card of cards) {
      const userId = cleanText(card.user_id, 80);
      if (!userId) continue;
      const existing = cardsByUser.get(userId) ?? [];
      existing.push(card);
      cardsByUser.set(userId, existing);
    }

    const userIds = Array.from(cardsByUser.keys());
    const profiles = new Map<
      string,
      { nickname: string; isBanned: boolean; bannedReason: string }
    >();
    for (let index = 0; index < userIds.length; index += 200) {
      const chunk = userIds.slice(index, index + 200);
      const { data, error } = await guard.admin
        .from("profiles")
        .select("user_id,nickname,is_banned,banned_reason")
        .in("user_id", chunk);
      if (error) throw error;
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const userId = cleanText(row.user_id, 80);
        if (!userId) continue;
        profiles.set(userId, {
          nickname: cleanText(row.nickname, 80),
          isBanned: row.is_banned === true,
          bannedReason: cleanText(row.banned_reason, 300),
        });
      }
    }

    const currentYear = new Date().getFullYear();
    const items = Array.from(cardsByUser.entries()).flatMap(([userId, userCards]) => {
      const findings = userCards.flatMap(reviewCard);
      const suspiciousCardIds = new Set(findings.map((finding) => finding.cardId));
      const userDeletedCount = userCards.filter((card) => cleanTags(card.admin_tags).includes(USER_DELETED_TAG)).length;
      const activeCount = userCards.filter((card) => ACTIVE_STATUSES.has(cleanText(card.status, 40))).length;
      const fingerprintCounts = new Map<string, number>();
      for (const card of userCards) {
        const fingerprint = contentFingerprint(card);
        if (fingerprint) fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + 1);
      }
      const duplicateContentCount = Math.max(0, ...Array.from(fingerprintCounts.values()).map((count) => count - 1));
      const registrationCount = userCards.length;
      const hasContactAndRepeat = suspiciousCardIds.size > 0 && (registrationCount >= 2 || userDeletedCount >= 1);
      const hasHeavyRepeat = registrationCount >= 3 && (userDeletedCount >= 1 || duplicateContentCount >= 1);
      if (!hasContactAndRepeat && !hasHeavyRepeat) return [];

      const latestCard = userCards[0];
      const profile = profiles.get(userId) ?? { nickname: "", isBanned: false, bannedReason: "" };
      const score =
        suspiciousCardIds.size * 40 +
        userDeletedCount * 18 +
        duplicateContentCount * 15 +
        Math.max(0, registrationCount - 1) * 6;
      const level: "high" | "medium" = hasContactAndRepeat ? "high" : "medium";

      return [
        {
          userId,
          nickname: profile.nickname,
          isBanned: profile.isBanned,
          bannedReason: profile.bannedReason,
          level,
          score,
          registrationCount,
          userDeletedCount,
          activeCount,
          suspiciousCardCount: suspiciousCardIds.size,
          duplicateContentCount,
          latestCreatedAt: cleanText(latestCard.created_at, 80) || null,
          latestCard: {
            cardId: cleanText(latestCard.id, 80),
            status: cleanText(latestCard.status, 40),
            name: cleanText(latestCard.name, 120),
            age:
              typeof latestCard.birth_year === "number"
                ? currentYear - latestCard.birth_year + 1
                : null,
            region: cleanText(latestCard.region, 100),
            job: cleanText(latestCard.job, 100),
          },
          findings: findings.slice(0, 12),
          cards: userCards.slice(0, 12).map((card) => ({
            cardId: cleanText(card.id, 80),
            status: cleanText(card.status, 40),
            name: cleanText(card.name, 120),
            userDeleted: cleanTags(card.admin_tags).includes(USER_DELETED_TAG),
            createdAt: cleanText(card.created_at, 80) || null,
            updatedAt: cleanText(card.updated_at, 80) || null,
          })),
        },
      ];
    });

    items.sort((a, b) => b.score - a.score || String(b.latestCreatedAt ?? "").localeCompare(String(a.latestCreatedAt ?? "")));

    return NextResponse.json({
      ok: true,
      reviewWindowDays: REVIEW_WINDOW_DAYS,
      scannedCount: cards.length,
      suspiciousUserCount: items.length,
      items,
    });
  } catch (error) {
    console.error("[admin 1on1 abuse review] load failed", error);
    return NextResponse.json(
      {
        ok: false,
        message: "1:1 반복 악용 검수 목록을 불러오지 못했습니다.",
        detail: error instanceof Error ? error.message : "unknown",
      },
      { status: 500 }
    );
  }
}
