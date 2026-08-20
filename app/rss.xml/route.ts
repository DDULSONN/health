import { SEO_GUIDES } from "@/lib/seo-guides";

const BASE_URL = "https://helchang.com";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const revalidate = 86400;

export function GET() {
  const items = [...SEO_GUIDES]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((guide) => {
      const url = `${BASE_URL}/guide/${guide.slug}`;
      return [
        "<item>",
        `<title>${escapeXml(guide.title)}</title>`,
        `<link>${url}</link>`,
        `<guid isPermaLink="true">${url}</guid>`,
        `<description>${escapeXml(guide.description)}</description>`,
        `<category>${escapeXml(guide.category)}</category>`,
        `<pubDate>${new Date(`${guide.publishedAt}T00:00:00+09:00`).toUTCString()}</pubDate>`,
        "</item>",
      ].join("");
    })
    .join("");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    "<title>짐툴 운동과 소개팅 가이드</title>",
    `<link>${BASE_URL}/guide</link>`,
    "<description>운동하는 사람의 소개팅, 첫 만남, 프로필과 관계에 관한 짐툴 가이드</description>",
    "<language>ko-KR</language>",
    `<lastBuildDate>${new Date(`${SEO_GUIDES[0]?.updatedAt ?? "2026-08-20"}T00:00:00+09:00`).toUTCString()}</lastBuildDate>`,
    items,
    "</channel>",
    "</rss>",
  ].join("");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
