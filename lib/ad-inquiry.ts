import { createAdminClient } from "@/lib/supabase/server";

export const DEFAULT_OPENKAKAO_URL =
  process.env.NEXT_PUBLIC_OPENKAKAO_URL ?? "https://open.kakao.com/o/s2gvTdhi";

export const AD_INQUIRY_SETTING_KEY = "ad_inquiry_slot";

export type AdInquirySetting = {
  enabled: boolean;
  title: string;
  description: string;
  cta: string;
  linkUrl: string;
  badge: string;
  theme: "emerald" | "rose" | "violet" | "sky" | "amber" | "neutral";
};

export const DEFAULT_AD_INQUIRY_SETTING: AdInquirySetting = {
  enabled: false,
  title: "헬스장 로테이션 소개팅 참여하기",
  description: "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요.",
  cta: "자세히 보기",
  linkUrl: DEFAULT_OPENKAKAO_URL,
  badge: "AD",
  theme: "emerald",
};

export function normalizeAdInquirySetting(value: unknown): AdInquirySetting {
  if (!value || typeof value !== "object") {
    return DEFAULT_AD_INQUIRY_SETTING;
  }

  const raw = value as Record<string, unknown>;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_AD_INQUIRY_SETTING.enabled;
  const title =
    typeof raw.title === "string" && raw.title.trim().length > 0
      ? raw.title.trim().slice(0, 40)
      : DEFAULT_AD_INQUIRY_SETTING.title;
  const description =
    typeof raw.description === "string" && raw.description.trim().length > 0
      ? raw.description.trim().slice(0, 140)
      : DEFAULT_AD_INQUIRY_SETTING.description;
  const cta =
    typeof raw.cta === "string" && raw.cta.trim().length > 0
      ? raw.cta.trim().slice(0, 24)
      : DEFAULT_AD_INQUIRY_SETTING.cta;
  const badge =
    typeof raw.badge === "string" && raw.badge.trim().length > 0
      ? raw.badge.trim().slice(0, 20)
      : DEFAULT_AD_INQUIRY_SETTING.badge;
  const theme =
    raw.theme === "rose" ||
    raw.theme === "violet" ||
    raw.theme === "sky" ||
    raw.theme === "amber" ||
    raw.theme === "neutral" ||
    raw.theme === "emerald"
      ? raw.theme
      : DEFAULT_AD_INQUIRY_SETTING.theme;
  const rawLinkUrl = typeof raw.linkUrl === "string" ? raw.linkUrl.trim() : "";
  const linkUrl =
    rawLinkUrl.startsWith("/") || /^https?:\/\//i.test(rawLinkUrl)
      ? rawLinkUrl.slice(0, 300)
      : DEFAULT_AD_INQUIRY_SETTING.linkUrl;

  return {
    enabled,
    title,
    description,
    cta,
    linkUrl,
    badge,
    theme,
  };
}

export async function readAdInquirySetting() {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("site_settings")
    .select("value_json")
    .eq("key", AD_INQUIRY_SETTING_KEY)
    .maybeSingle();

  if (error) {
    console.error("[readAdInquirySetting] failed", error);
    return DEFAULT_AD_INQUIRY_SETTING;
  }

  return normalizeAdInquirySetting(data?.value_json);
}
