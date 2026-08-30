import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://helchang.com").origin;

  return [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/dating/1on1`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${baseUrl}/community/dating/cards`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/1rm`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/lifts`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${baseUrl}/protein`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/snacks`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/tools`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/flirting-generator`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/community`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/community/bodycheck`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/certify`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/ad-inquiry`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
