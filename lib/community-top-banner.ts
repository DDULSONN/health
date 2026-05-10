export const COMMUNITY_TOP_BANNER_KEY = "community_top_banner";

export type CommunityTopBannerSetting = {
  enabled: boolean;
  title: string;
  description: string;
  cta: string;
  linkUrl: string;
};

export const DEFAULT_COMMUNITY_TOP_BANNER: CommunityTopBannerSetting = {
  enabled: false,
  title: "",
  description: "",
  cta: "자세히 보기",
  linkUrl: "",
};

export function normalizeCommunityTopBanner(value: unknown): CommunityTopBannerSetting {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const title = typeof source.title === "string" ? source.title.trim().slice(0, 80) : "";
  const description = typeof source.description === "string" ? source.description.trim().slice(0, 160) : "";
  const cta =
    typeof source.cta === "string" && source.cta.trim()
      ? source.cta.trim().slice(0, 30)
      : DEFAULT_COMMUNITY_TOP_BANNER.cta;
  const linkUrl = typeof source.linkUrl === "string" ? source.linkUrl.trim().slice(0, 500) : "";

  return {
    enabled: source.enabled === true && Boolean(title) && Boolean(linkUrl),
    title,
    description,
    cta,
    linkUrl,
  };
}
