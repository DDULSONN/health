import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

const UNSUBSCRIBE_TABLE = "email_marketing_unsubscribes";

type AdminClient = SupabaseClient;

type UnsubscribeRow = {
  user_id: string | null;
};

function isMissingUnsubscribeTableError(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes(UNSUBSCRIBE_TABLE) ||
    message.toLowerCase().includes("schema cache")
  );
}

function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    "https://helchang.com"
  ).replace(/\/+$/, "");
}

function getTokenSecret() {
  return (
    process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.RESEND_API_KEY?.trim() ||
    "local-dev-email-unsubscribe-secret"
  );
}

function normalizeEmail(email: string | null | undefined) {
  return String(email ?? "").trim().toLowerCase();
}

export function normalizeMarketingSubject(subject: string) {
  const clean = String(subject ?? "").trim().replace(/^\[광고\]\s*/i, "");
  return `[광고] ${clean || "GymTools 안내"}`;
}

export function createEmailUnsubscribeToken(input: {
  userId: string;
  email: string | null | undefined;
  campaignKey: string;
}) {
  return crypto
    .createHmac("sha256", getTokenSecret())
    .update(`${input.userId}:${normalizeEmail(input.email)}:${input.campaignKey}`)
    .digest("hex");
}

export function verifyEmailUnsubscribeToken(input: {
  userId: string;
  email: string | null | undefined;
  campaignKey: string;
  token: string | null | undefined;
}) {
  const token = String(input.token ?? "").trim();
  if (!token) return false;
  const expected = createEmailUnsubscribeToken(input);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function buildEmailUnsubscribeUrl(input: {
  userId: string;
  email: string | null | undefined;
  campaignKey: string;
}) {
  const url = new URL("/api/email/unsubscribe", getSiteUrl());
  url.searchParams.set("uid", input.userId);
  url.searchParams.set("email", normalizeEmail(input.email));
  url.searchParams.set("campaign", input.campaignKey);
  url.searchParams.set("token", createEmailUnsubscribeToken(input));
  return url.toString();
}

export function appendMarketingEmailFooter(input: {
  body: string;
  userId: string;
  email: string | null | undefined;
  campaignKey: string;
}) {
  const unsubscribeUrl = buildEmailUnsubscribeUrl(input);
  const trimmedBody = String(input.body ?? "").trim();
  return [
    trimmedBody,
    "",
    "-----",
    "본 메일은 GymTools 서비스 이용 회원에게 발송되는 광고성 안내 메일입니다.",
    "더 이상 GymTools 안내 메일을 받고 싶지 않다면 아래 링크에서 수신거부할 수 있습니다.",
    unsubscribeUrl,
    "",
    "발신자: GymTools",
    "문의: gymtools.kr@gmail.com",
  ].join("\n");
}

export async function fetchMarketingUnsubscribedUserIds(
  admin: AdminClient,
  userIds: string[],
  campaignKey: string
) {
  const unsubscribed = new Set<string>();
  if (!userIds.length) return unsubscribed;

  for (let start = 0; start < userIds.length; start += 500) {
    const chunk = userIds.slice(start, start + 500);
    const res = await admin
      .from(UNSUBSCRIBE_TABLE)
      .select("user_id")
      .in("user_id", chunk)
      .in("campaign_key", [campaignKey, "all"]);

    if (res.error) {
      if (isMissingUnsubscribeTableError(res.error)) {
        console.warn(`[marketing-email] missing table: ${UNSUBSCRIBE_TABLE}`);
        return unsubscribed;
      }
      throw new Error(`수신거부 목록을 불러오지 못했습니다. ${res.error.message}`);
    }

    for (const row of (res.data ?? []) as UnsubscribeRow[]) {
      const userId = String(row.user_id ?? "").trim();
      if (userId) unsubscribed.add(userId);
    }
  }

  return unsubscribed;
}
