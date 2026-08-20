import type { Metadata } from "next";
import Link from "next/link";
import { SEO_GUIDES } from "@/lib/seo-guides";

export const metadata: Metadata = {
  title: "운동과 소개팅 가이드",
  description: "헬스·러닝을 즐기는 사람의 소개팅, 프로필 작성, 첫 만남과 안전한 관계를 위한 짐툴 가이드입니다.",
  alternates: { canonical: "https://helchang.com/guide" },
  openGraph: {
    title: "운동과 소개팅 가이드 | 짐툴",
    description: "운동하는 사람의 만남과 관계에 필요한 현실적인 정보를 확인해보세요.",
    url: "https://helchang.com/guide",
    siteName: "짐툴 GymTools",
    locale: "ko_KR",
    type: "website",
  },
};

export default function GuideIndexPage() {
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "짐툴 운동과 소개팅 가이드",
    itemListElement: SEO_GUIDES.map((guide, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: guide.title,
      url: `https://helchang.com/guide/${guide.slug}`,
    })),
  };

  return (
    <main className="bg-gradient-to-b from-rose-50 via-white to-white px-4 py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      <div className="mx-auto max-w-5xl">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-rose-600">JIMTOOL GUIDE</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-neutral-950 sm:text-4xl">운동하는 사람의 만남 가이드</h1>
          <p className="mt-4 text-base leading-7 text-neutral-600">
            운동 취향이 비슷한 사람을 만나고, 서로를 존중하며 안전하게 관계를 시작하는 데 필요한 정보를 정리했습니다.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {SEO_GUIDES.map((guide) => (
            <article key={guide.slug} className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center gap-2 text-xs font-semibold text-rose-600">
                <span>{guide.category}</span>
                <span className="text-neutral-300">·</span>
                <span className="text-neutral-500">약 {guide.readingMinutes}분</span>
              </div>
              <h2 className="mt-3 text-xl font-bold leading-8 text-neutral-950">
                <Link href={`/guide/${guide.slug}`} className="hover:text-rose-600">
                  {guide.title}
                </Link>
              </h2>
              <p className="mt-3 text-sm leading-6 text-neutral-600">{guide.description}</p>
              <Link href={`/guide/${guide.slug}`} className="mt-5 inline-flex text-sm font-semibold text-rose-600 hover:text-rose-700">
                자세히 읽기 →
              </Link>
            </article>
          ))}
        </div>

        <section className="mt-12 rounded-3xl bg-neutral-950 px-6 py-8 text-white sm:px-10">
          <p className="text-sm font-semibold text-rose-300">운동 취향이 맞는 사람을 찾고 있나요?</p>
          <h2 className="mt-2 text-2xl font-bold">가입 전에 실제 오픈카드부터 둘러보세요.</h2>
          <Link href="/community/dating/cards" className="mt-5 inline-flex rounded-full bg-rose-500 px-5 py-3 text-sm font-bold text-white hover:bg-rose-400">
            오픈카드 보기
          </Link>
        </section>
      </div>
    </main>
  );
}
