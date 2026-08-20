import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/auth/",
        "/chat/",
        "/login",
        "/mypage/",
        "/notifications/",
        "/onboarding/",
        "/payments/",
        "/phone-verification/",
        "/signup",
      ],
    },
    host: "https://helchang.com",
    sitemap: "https://helchang.com/sitemap.xml",
  };
}
