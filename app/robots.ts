import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/"] },
    host: "https://helchang.com",
    sitemap: "https://helchang.com/sitemap.xml",
  };
}
