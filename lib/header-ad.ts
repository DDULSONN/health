export const HEADER_AD_SETTING_KEY = "header_ad_banner";

export type HeaderAdSetting = {
  enabled: boolean;
  imageUrl: string;
  linkUrl: string;
  altText: string;
  startsAt: string | null;
  expiresAt: string | null;
};

export type PublicHeaderAd = Pick<HeaderAdSetting, "imageUrl" | "linkUrl" | "altText"> & {
  visible: boolean;
};

export const DEFAULT_HEADER_AD_SETTING: HeaderAdSetting = {
  enabled: false,
  imageUrl: "",
  linkUrl: "",
  altText: "",
  startsAt: null,
  expiresAt: null,
};

function normalizeLinkUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const url = value.trim().slice(0, 800);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
  if (url.startsWith("https://")) return url;
  return "";
}

function normalizeImageUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const url = value.trim().slice(0, 800);
  if (!url.startsWith("/i/public-lite/community/header-ads/") || url.includes("\\")) return "";
  return url;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeHeaderAdSetting(value: unknown): HeaderAdSetting {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: source.enabled === true,
    imageUrl: normalizeImageUrl(source.imageUrl),
    linkUrl: normalizeLinkUrl(source.linkUrl),
    altText: typeof source.altText === "string" ? source.altText.trim().slice(0, 100) : "",
    startsAt: normalizeDate(source.startsAt),
    expiresAt: normalizeDate(source.expiresAt),
  };
}

export function isHeaderAdVisible(setting: HeaderAdSetting, now = new Date()) {
  if (!setting.enabled || !setting.imageUrl || !setting.linkUrl) return false;
  const nowMs = now.getTime();
  if (setting.startsAt && new Date(setting.startsAt).getTime() > nowMs) return false;
  if (setting.expiresAt && new Date(setting.expiresAt).getTime() <= nowMs) return false;
  return true;
}

export function toPublicHeaderAd(setting: HeaderAdSetting, now = new Date()): PublicHeaderAd {
  const visible = isHeaderAdVisible(setting, now);
  return {
    visible,
    imageUrl: visible ? setting.imageUrl : "",
    linkUrl: visible ? setting.linkUrl : "",
    altText: visible ? setting.altText || "광고" : "",
  };
}
