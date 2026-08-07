import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { reviewOneOnOneName } from "@/lib/dating-1on1-name-review";
import { createAdminClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const PAGE_SIZE = 1000;
const MAX_SCAN_COUNT = 20000;
const ACTIVE_STATUSES = ["submitted", "reviewing", "approved"];

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
};

function cleanText(value: unknown, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 80)).filter(Boolean);
}

async function loadCards(admin: ReturnType<typeof createAdminClient>) {
  const rows: OneOnOneCardRow[] = [];
  while (rows.length < MAX_SCAN_COUNT) {
    const from = rows.length;
    const to = Math.min(from + PAGE_SIZE, MAX_SCAN_COUNT) - 1;
    const { data, error } = await admin
      .from("dating_1on1_cards")
      .select(
        "id,user_id,status,name,birth_year,region,job,intro_text,strengths_text,preferred_partner_text,admin_tags,created_at"
      )
      .in("status", ACTIVE_STATUSES)
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
    const cards = await loadCards(guard.admin);
    const userIds = Array.from(new Set(cards.map((card) => cleanText(card.user_id, 80)).filter(Boolean)));
    const nicknames = new Map<string, string>();

    for (let index = 0; index < userIds.length; index += 200) {
      const chunk = userIds.slice(index, index + 200);
      const { data, error } = await guard.admin.from("profiles").select("user_id,nickname").in("user_id", chunk);
      if (error) throw error;
      for (const row of (data ?? []) as Array<{ user_id?: unknown; nickname?: unknown }>) {
        const userId = cleanText(row.user_id, 80);
        if (userId) nicknames.set(userId, cleanText(row.nickname, 80));
      }
    }

    const currentYear = new Date().getFullYear();
    const items = cards.flatMap((card) => {
      const review = reviewOneOnOneName(card.name);
      if (!review.suspicious) return [];
      const userId = cleanText(card.user_id, 80);
      const tags = cleanTags(card.admin_tags);
      return [
        {
          cardId: cleanText(card.id, 80),
          userId,
          status: cleanText(card.status, 40),
          name: cleanText(card.name, 120),
          nickname: nicknames.get(userId) ?? "",
          age: typeof card.birth_year === "number" ? currentYear - card.birth_year + 1 : null,
          region: cleanText(card.region, 80),
          job: cleanText(card.job, 80),
          editLocked: tags.includes("one_on_one_edit_locked"),
          createdAt: cleanText(card.created_at, 80) || null,
          level: review.level,
          flags: review.flags,
          editableFields: {
            displayName: cleanText(card.name, 120),
            job: cleanText(card.job, 80),
            region: cleanText(card.region, 80),
            intro: cleanText(card.intro_text),
            strengths: cleanText(card.strengths_text, 1000),
            ideal: "",
            preferredPartner: cleanText(card.preferred_partner_text, 1000),
            instagramId: "",
          },
        },
      ];
    });

    return NextResponse.json({ ok: true, scannedCount: cards.length, suspiciousCount: items.length, items });
  } catch (error) {
    console.error("[admin 1on1 name review] load failed", error);
    return NextResponse.json(
      { ok: false, message: "1대1 이름 검수 목록을 불러오지 못했습니다.", detail: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
