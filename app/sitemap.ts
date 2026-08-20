import type { MetadataRoute } from "next";
import { SEO_GUIDES } from "@/lib/seo-guides";

const BASE_URL = "https://helchang.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE_URL}/guide`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE_URL}/1rm`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/tools`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/flirting-generator`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/lifts`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/snacks`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/certify`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/dating/1on1`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/community`, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE_URL}/community/dating/cards`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/community/bodycheck`, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE_URL}/dating-policy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const guidePages: MetadataRoute.Sitemap = SEO_GUIDES.map((guide) => ({
    url: `${BASE_URL}/guide/${guide.slug}`,
    lastModified: new Date(guide.updatedAt),
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [...staticPages, ...guidePages];
}
