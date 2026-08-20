import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRelatedSeoGuides, getSeoGuide, SEO_GUIDES } from "@/lib/seo-guides";

type GuidePageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return SEO_GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = getSeoGuide(slug);
  if (!guide) return {};

  const url = `https://helchang.com/guide/${guide.slug}`;
  return {
    title: guide.title,
    description: guide.description,
    keywords: guide.keywords,
    alternates: { canonical: url },
    openGraph: {
      title: `${guide.title} | 짐툴`,
      description: guide.description,
      url,
      siteName: "짐툴 GymTools",
      locale: "ko_KR",
      type: "article",
      publishedTime: guide.publishedAt,
      modifiedTime: guide.updatedAt,
    },
    twitter: {
      card: "summary",
      title: guide.title,
      description: guide.description,
    },
  };
}

export default async function GuideDetailPage({ params }: GuidePageProps) {
  const { slug } = await params;
  const guide = getSeoGuide(slug);
  if (!guide) notFound();

  const url = `https://helchang.com/guide/${guide.slug}`;
  const related = getRelatedSeoGuides(guide);
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    datePublished: guide.publishedAt,
    dateModified: guide.updatedAt,
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: "짐툴 운영팀", url: "https://helchang.com" },
    publisher: { "@type": "Organization", name: "짐툴 GymTools", url: "https://helchang.com" },
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "짐툴", item: "https://helchang.com" },
      { "@type": "ListItem", position: 2, name: "가이드", item: "https://helchang.com/guide" },
      { "@type": "ListItem", position: 3, name: guide.title, item: url },
    ],
  };

  return (
    <main className="bg-white px-4 py-10 sm:py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <article className="mx-auto max-w-3xl">
        <nav aria-label="이동 경로" className="text-sm text-neutral-500">
          <Link href="/" className="hover:text-neutral-800">짐툴</Link>
          <span className="mx-2">/</span>
          <Link href="/guide" className="hover:text-neutral-800">가이드</Link>
        </nav>

        <header className="mt-8 border-b border-neutral-200 pb-8">
          <p className="text-sm font-semibold text-rose-600">{guide.category}</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-neutral-950 sm:text-4xl">{guide.title}</h1>
          <p className="mt-5 text-lg leading-8 text-neutral-600">{guide.description}</p>
          <div className="mt-5 flex flex-wrap gap-3 text-xs text-neutral-500">
            <span>짐툴 운영팀</span>
            <span>·</span>
            <time dateTime={guide.updatedAt}>업데이트 {guide.updatedAt.replaceAll("-", ". ")}</time>
            <span>·</span>
            <span>약 {guide.readingMinutes}분</span>
          </div>
        </header>

        <div className="space-y-10 py-10">
          {guide.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-2xl font-bold tracking-tight text-neutral-950">{section.heading}</h2>
              <div className="mt-4 space-y-4 text-base leading-8 text-neutral-700">
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              {section.bullets ? (
                <ul className="mt-5 space-y-3 rounded-2xl bg-neutral-50 p-5 text-sm leading-7 text-neutral-700">
                  {section.bullets.map((bullet) => <li key={bullet} className="flex gap-3"><span className="text-rose-500">✓</span><span>{bullet}</span></li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <section className="rounded-3xl bg-rose-50 px-6 py-8 text-center">
          <h2 className="text-xl font-bold text-neutral-950">운동 취향이 맞는 사람을 만나보세요</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">가입 전 공개된 오픈카드를 먼저 둘러볼 수 있습니다.</p>
          <Link href="/community/dating/cards" className="mt-5 inline-flex rounded-full bg-rose-500 px-5 py-3 text-sm font-bold text-white hover:bg-rose-600">
            오픈카드 보기
          </Link>
        </section>

        <section className="mt-12 border-t border-neutral-200 pt-8">
          <h2 className="text-lg font-bold text-neutral-950">함께 읽으면 좋은 글</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {related.map((item) => (
              <Link key={item.slug} href={`/guide/${item.slug}`} className="rounded-2xl border border-neutral-200 p-4 text-sm font-semibold leading-6 text-neutral-800 hover:border-rose-200 hover:text-rose-600">
                {item.title}
              </Link>
            ))}
          </div>
        </section>
      </article>
    </main>
  );
}
