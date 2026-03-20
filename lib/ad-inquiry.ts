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
};

export const DEFAULT_AD_INQUIRY_SETTING: AdInquirySetting = {
  enabled: true,
  title: "(광고) 문의 주세요",
  description: "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요.",
  cta: "오픈카톡 문의",
  linkUrl: DEFAULT_OPENKAKAO_URL,
  badge: "AD SLOT",
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
  const linkUrl =
    typeof raw.linkUrl === "string" && /^https?:\/\//i.test(raw.linkUrl.trim())
      ? raw.linkUrl.trim().slice(0, 300)
      : DEFAULT_AD_INQUIRY_SETTING.linkUrl;

  return {
    enabled,
    title,
    description,
    cta,
    linkUrl,
    badge,
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
