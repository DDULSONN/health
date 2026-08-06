import type { SupabaseClient } from "@supabase/supabase-js";

export type NicknameSuspicionLevel = "medium" | "high";
export type NicknameReviewStatus = "pending" | "dismissed" | "actioned" | "cleared";

type NicknameFinding = {
  level: NicknameSuspicionLevel;
  flags: string[];
};

type ProfileRow = {
  user_id: string;
  nickname: string | null;
  role: string | null;
  is_banned: boolean | null;
};

type ExistingReviewRow = {
  id: string;
  user_id: string;
  nickname: string;
  status: NicknameReviewStatus;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
  resolution_note: string | null;
};

const PAGE_SIZE = 1000;
const WRITE_BATCH_SIZE = 300;
const FILTER_BATCH_SIZE = 100;

const PROFANITY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "욕설 또는 비하 표현", pattern: /(씨+발|시+발|ㅅㅂ|병+신|ㅂㅅ|좆|존나|개새끼|개색기|지랄|미친(?:놈|년)|fuck|shit|bitch|asshole)/i },
  { label: "성적 표현", pattern: /(섹스|sex|야동|자지|보지)/i },
];

const CONTACT_PATTERNS: Array<{ label: string; level: NicknameSuspicionLevel; pattern: RegExp }> = [
  {
    label: "휴대폰 번호 의심",
    level: "high",
    pattern: /(?:^|\D)01[016789](?:[\s().-]*\d){7,8}(?:\D|$)/,
  },
  {
    label: "SNS 또는 메신저 표기",
    level: "high",
    pattern: /(인스타(?:그램)?|insta(?:gram)?|카톡|카카오|오픈채팅|오픈챗|텔레그램|telegram|라인|line|디엠|\bdm\b)/i,
  },
  {
    label: "외부 계정 주소",
    level: "high",
    pattern: /(https?:\/\/|www\.|instagram\.com|open\.kakao|t\.me|linktr\.ee)/i,
  },
  {
    label: "외부 계정 아이디 의심",
    level: "high",
    pattern: /(^|[^0-9A-Za-z._])@[0-9A-Za-z._-]{3,}/,
  },
  {
    label: "아이디 또는 계정 표기",
    level: "medium",
    pattern: /(아이디|계정|\bid\b)\s*[:=_-]?\s*[0-9A-Za-z._-]{3,}/i,
  },
];

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function normalizedNickname(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function reviewNickname(value: unknown): NicknameFinding | null {
  const nickname = normalizedNickname(value);
  if (!nickname) return null;

  const flags: string[] = [];
  let level: NicknameSuspicionLevel = "medium";

  for (const rule of CONTACT_PATTERNS) {
    if (!rule.pattern.test(nickname)) continue;
    flags.push(rule.label);
    if (rule.level === "high") level = "high";
  }

  const digitsOnly = nickname.replace(/\D/g, "");
  if (/^01[016789]\d{7,8}$/.test(digitsOnly)) {
    flags.push("휴대폰 번호 의심");
    level = "high";
  }

  for (const rule of PROFANITY_PATTERNS) {
    if (!rule.pattern.test(nickname)) continue;
    flags.push(rule.label);
    level = "high";
  }

  const looksLikeExternalId =
    /^[0-9A-Za-z][0-9A-Za-z._-]{3,23}$/.test(nickname) &&
    /[A-Za-z]/.test(nickname) &&
    /[._-]/.test(nickname);
  if (looksLikeExternalId) {
    flags.push("외부 계정 형태 의심");
  }

  const resolvedFlags = unique(flags);
  return resolvedFlags.length > 0 ? { level, flags: resolvedFlags } : null;
}

export function isNicknameReviewTableMissing(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = String(candidate?.code ?? "");
  const message = String(candidate?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("admin_nickname_reviews") &&
      (message.includes("does not exist") || message.includes("schema cache") || message.includes("not found"))
  );
}

async function loadAllProfiles(admin: SupabaseClient) {
  const rows: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("profiles")
      .select("user_id,nickname,role,is_banned")
      .order("user_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as ProfileRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadAllExistingReviews(admin: SupabaseClient) {
  const rows: ExistingReviewRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("admin_nickname_reviews")
      .select("id,user_id,nickname,status,reviewed_at,reviewed_by_user_id,resolution_note")
      .order("user_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as ExistingReviewRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function scanNicknameReviews(admin: SupabaseClient) {
  const [profiles, existingReviews] = await Promise.all([
    loadAllProfiles(admin),
    loadAllExistingReviews(admin),
  ]);
  const now = new Date().toISOString();
  const existingByUserId = new Map(existingReviews.map((row) => [row.user_id, row]));
  const scannedUserIds = new Set<string>();
  const upserts: Array<Record<string, unknown>> = [];
  let suspiciousCount = 0;
  let newlyPendingCount = 0;

  for (const profile of profiles) {
    if (!profile.user_id || profile.role === "admin" || profile.is_banned === true) continue;
    scannedUserIds.add(profile.user_id);
    const nickname = normalizedNickname(profile.nickname);
    const finding = reviewNickname(nickname);
    if (!finding) continue;

    suspiciousCount += 1;
    const existing = existingByUserId.get(profile.user_id);
    const nicknameChanged = existing ? existing.nickname !== nickname : true;
    const preserveResolvedStatus =
      existing &&
      !nicknameChanged &&
      (existing.status === "dismissed" || existing.status === "actioned");
    const status = preserveResolvedStatus ? existing.status : "pending";
    if (!existing || (existing.status !== "pending" && status === "pending")) newlyPendingCount += 1;

    upserts.push({
      user_id: profile.user_id,
      nickname,
      suspicion_level: finding.level,
      flags: finding.flags,
      status,
      first_detected_at: existing?.id ? undefined : now,
      last_detected_at: now,
      reviewed_at: status === "pending" ? null : existing?.reviewed_at ?? null,
      reviewed_by_user_id: status === "pending" ? null : existing?.reviewed_by_user_id ?? null,
      resolution_note: status === "pending" ? null : existing?.resolution_note ?? null,
      updated_at: now,
    });
  }

  for (let index = 0; index < upserts.length; index += WRITE_BATCH_SIZE) {
    const batch = upserts.slice(index, index + WRITE_BATCH_SIZE).map((row) =>
      Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))
    );
    const { error } = await admin.from("admin_nickname_reviews").upsert(batch, { onConflict: "user_id" });
    if (error) throw error;
  }

  const suspiciousUserIds = new Set(upserts.map((row) => String(row.user_id)));
  const clearIds = existingReviews
    .filter(
      (row) =>
        row.status === "pending" &&
        (!scannedUserIds.has(row.user_id) || !suspiciousUserIds.has(row.user_id))
    )
    .map((row) => row.id);

  for (let index = 0; index < clearIds.length; index += FILTER_BATCH_SIZE) {
    const { error } = await admin
      .from("admin_nickname_reviews")
      .update({ status: "cleared", updated_at: now })
      .in("id", clearIds.slice(index, index + FILTER_BATCH_SIZE));
    if (error) throw error;
  }

  return {
    scannedCount: profiles.length,
    suspiciousCount,
    newlyPendingCount,
    clearedCount: clearIds.length,
    scannedAt: now,
  };
}
