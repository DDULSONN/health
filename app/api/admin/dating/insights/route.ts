import { isAllowedAdminUser } from "@/lib/admin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type SourceType = "open_card" | "paid_card" | "one_on_one";
type PersonSex = "male" | "female";

type PreferenceRow = {
  source_type: SourceType;
  sex: PersonSex;
  ideal_text: string;
};

type SignalKey =
  | "kindness"
  | "conversation"
  | "fitness"
  | "clean_lifestyle"
  | "stability"
  | "height_body"
  | "appearance"
  | "habits";

const BATCH_SIZE = 1000;
const TOKEN_REGEX = /[0-9A-Za-z]+|[가-힣]{2,}/g;

const STOPWORDS = new Set([
  "그냥",
  "정도",
  "사람",
  "사람이",
  "사람은",
  "좋은",
  "좋고",
  "좋아",
  "있는",
  "없는",
  "이면",
  "같은",
  "하는",
  "하고",
  "해서",
  "이면",
  "정말",
  "느낌",
  "스타일",
  "prefer",
  "with",
  "that",
  "have",
  "this",
  "from",
  "would",
]);

const SIGNALS: Array<{ key: SignalKey; regex: RegExp }> = [
  { key: "kindness", regex: /(다정|배려|착한|이해심|센스|친절|상냥|매너)/i },
  { key: "conversation", regex: /(대화|티키타카|소통|유머|말이|재밌|웃긴|코드|잘통)/i },
  { key: "fitness", regex: /(운동|헬스|자기관리|관리하는|몸관리|식단|벌크|린매스|근육)/i },
  { key: "clean_lifestyle", regex: /(비흡연|금연|흡연 안|담배 안|깔끔|청결|문신 없)/i },
  { key: "stability", regex: /(성실|안정|책임감|직장|미래|배울 점|성장|성숙)/i },
  { key: "height_body", regex: /(키|큰 편|180|181|182|183|184|185|186|체격|피지컬)/i },
  { key: "appearance", regex: /(외모|인상|귀여운|훈훈|잘생|예쁜|선한 인상|분위기)/i },
  { key: "habits", regex: /(생활|집돌이|집순이|취미|루틴|패턴|생활습관|가치관)/i },
];

function uniqueTokens(text: string) {
  const matches = text.toLowerCase().match(TOKEN_REGEX) ?? [];
  return [
    ...new Set(
      matches
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && token.length <= 18)
        .filter((token) => !STOPWORDS.has(token))
    ),
  ];
}

async function fetchAllRows(table: string, select: string) {
  const admin = createAdminClient();
  const rows: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .order("created_at", { ascending: false })
      .range(from, from + BATCH_SIZE - 1);

    if (error) {
      throw error;
    }

    const batch = Array.isArray(data) ? (data as unknown as Record<string, unknown>[]) : [];
    rows.push(...batch);

    if (batch.length < BATCH_SIZE) {
      break;
    }
    from += BATCH_SIZE;
  }

  return rows;
}

function roundPercent(count: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function summarizePreferenceGroup(rows: PreferenceRow[]) {
  const tokenCounts = new Map<string, number>();
  const signalCounts = new Map<SignalKey, number>();

  for (const row of rows) {
    const text = row.ideal_text;
    for (const token of uniqueTokens(text)) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
    for (const signal of SIGNALS) {
      if (signal.regex.test(text)) {
        signalCounts.set(signal.key, (signalCounts.get(signal.key) ?? 0) + 1);
      }
    }
  }

  return {
    response_count: rows.length,
    top_signals: SIGNALS.map((signal) => {
      const count = signalCounts.get(signal.key) ?? 0;
      return {
        key: signal.key,
        count,
        share_pct: roundPercent(count, rows.length),
      };
    })
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    top_tokens: [...tokenCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([token, count]) => ({
        token,
        count,
        share_pct: roundPercent(count, rows.length),
      })),
  };
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAllowedAdminUser(user.id, user.email)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  try {
    const [openRows, paidRows, oneOnOneRows] = await Promise.all([
      fetchAllRows("dating_cards", "sex,ideal_type,created_at"),
      fetchAllRows("dating_paid_cards", "gender,ideal_text,created_at"),
      fetchAllRows("dating_1on1_cards", "sex,preferred_partner_text,created_at"),
    ]);

    const preferenceRows: PreferenceRow[] = [
      ...openRows
        .filter((row) => typeof row.ideal_type === "string" && String(row.ideal_type).trim())
        .map((row) => ({
          source_type: "open_card" as const,
          sex: (row.sex === "female" ? "female" : "male") as PersonSex,
          ideal_text: String(row.ideal_type ?? "").trim(),
        })),
      ...paidRows
        .filter((row) => typeof row.ideal_text === "string" && String(row.ideal_text).trim())
        .map((row) => ({
          source_type: "paid_card" as const,
          sex: (row.gender === "F" ? "female" : "male") as PersonSex,
          ideal_text: String(row.ideal_text ?? "").trim(),
        })),
      ...oneOnOneRows
        .filter(
          (row) =>
            typeof row.preferred_partner_text === "string" &&
            String(row.preferred_partner_text).trim()
        )
        .map((row) => ({
          source_type: "one_on_one" as const,
          sex: (row.sex === "female" ? "female" : "male") as PersonSex,
          ideal_text: String(row.preferred_partner_text ?? "").trim(),
        })),
    ];

    const femaleRows = preferenceRows.filter((row) => row.sex === "female");
    const maleRows = preferenceRows.filter((row) => row.sex === "male");
    const femaleSummary = summarizePreferenceGroup(femaleRows);
    const maleSummary = summarizePreferenceGroup(maleRows);

    const contrast = SIGNALS.map((signal) => {
      const femaleCount = femaleRows.filter((row) => signal.regex.test(row.ideal_text)).length;
      const maleCount = maleRows.filter((row) => signal.regex.test(row.ideal_text)).length;
      const femaleShare = roundPercent(femaleCount, femaleRows.length);
      const maleShare = roundPercent(maleCount, maleRows.length);
      return {
        key: signal.key,
        female_share_pct: femaleShare,
        male_share_pct: maleShare,
        gap_pct: Math.round((femaleShare - maleShare) * 10) / 10,
        common_share_pct: Math.round(Math.min(femaleShare, maleShare) * 10) / 10,
      };
    }).sort((a, b) => Math.abs(b.gap_pct) - Math.abs(a.gap_pct));

    return NextResponse.json(
      {
        generated_at: new Date().toISOString(),
        totals: {
          total: preferenceRows.length,
          female: femaleRows.length,
          male: maleRows.length,
          by_source: {
            open_card: preferenceRows.filter((row) => row.source_type === "open_card").length,
            paid_card: preferenceRows.filter((row) => row.source_type === "paid_card").length,
            one_on_one: preferenceRows.filter((row) => row.source_type === "one_on_one").length,
          },
        },
        female_preference: femaleSummary,
        male_preference: maleSummary,
        contrast,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[GET /api/admin/dating/insights] failed", error);
    return NextResponse.json({ error: "Failed to analyze dating preferences." }, { status: 500 });
  }
}
