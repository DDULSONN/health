import dynamic from "next/dynamic";
import Link from "next/link";
import AdInquiryFeatureCard from "@/components/AdInquiryFeatureCard";

const WeeklyTopBanner = dynamic(() => import("@/components/WeeklyTopBanner"), {
  loading: () => <HomeSectionSkeleton className="min-h-[152px]" />,
});

const HomeBodycheckQuickVote = dynamic(() => import("@/components/HomeBodycheckQuickVote"), {
  loading: () => <HomeSectionSkeleton className="min-h-[420px]" />,
});

type Feature = {
  id: string;
  href: string;
  title: string;
  emoji: string;
  description: string;
  accent: string;
  cta?: string;
  main?: boolean;
};

const FEATURES: Feature[] = [
  {
    id: "one_rm",
    href: "/1rm",
    title: "1RM 계산기",
    emoji: "🏋️",
    description: "중량과 반복 횟수로 1RM 추정값을 빠르게 계산해 보세요.",
    accent: "bg-emerald-50 border-emerald-200 hover:border-emerald-400",
    main: true,
    cta: "계산 시작",
  },
  {
    id: "lifts",
    href: "/lifts",
    title: "3대 합계 계산기",
    emoji: "🔢",
    description: "스쿼트, 벤치, 데드 3대 합계를 계산하고 기록도 확인해 보세요.",
    accent: "bg-rose-50 border-rose-200 hover:border-rose-400",
    cta: "합계 계산하기",
  },
  {
    id: "dating",
    href: "/community/dating",
    title: "소개팅",
    emoji: "💕",
    description: "오픈카드 소개팅을 둘러보고, 1:1 소개팅은 별도 탭에서 신청해 보세요.",
    accent: "bg-pink-50 border-pink-200 hover:border-pink-400",
    cta: "소개팅 보기",
  },
  {
    id: "community",
    href: "/community",
    title: "커뮤니티",
    emoji: "💬",
    description: "자유글, 운동 기록, 사진 몸평을 한 곳에서 편하게 둘러보세요.",
    accent: "bg-cyan-50 border-cyan-200 hover:border-cyan-400",
    cta: "커뮤니티 이동",
  },
  {
    id: "certify",
    href: "/certify",
    title: "3대 공식 인증",
    emoji: "✅",
    description: "영상 검증과 QR 인증으로 공식 인증서를 발급받아 보세요.",
    accent: "bg-lime-50 border-lime-200 hover:border-lime-400",
    cta: "인증 요청하기",
  },
  {
    id: "dating_1on1",
    href: "/dating/1on1",
    title: "1:1 스페셜 소개팅",
    emoji: "🤝",
    description: "운영자가 직접 매칭해 주는 1:1 소개팅을 요청해 보세요.",
    accent: "bg-blue-50 border-blue-200 hover:border-blue-400",
    cta: "1:1 소개팅 이동",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <WeeklyTopBanner />
      <HomeBodycheckQuickVote />

      <section className="mb-10 text-center">
        <h1 className="mb-2 text-3xl font-bold text-neutral-900">짐툴 (GymTools)</h1>
        <p className="text-base text-neutral-500">운동 계산기, 몸평, 소개팅 기능을 한곳에서.</p>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <Link
            key={feature.id}
            href={feature.href}
            className={`group block rounded-2xl border-2 p-5 transition-all active:scale-[0.99] ${feature.accent} ${
              feature.main ? "ring-2 ring-emerald-300 ring-offset-1" : ""
            }`}
          >
            <div className="flex items-start gap-4">
              <span className="shrink-0 text-3xl" aria-hidden>
                {feature.emoji}
              </span>
              <div className="min-w-0 w-full">
                <h2 className="text-lg font-bold text-neutral-900 transition-colors group-hover:text-emerald-700">
                  {feature.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-neutral-600">{feature.description}</p>
                {feature.cta ? <p className="mt-3 text-xs font-semibold text-emerald-700">{feature.cta}</p> : null}
              </div>
            </div>
          </Link>
        ))}
        <AdInquiryFeatureCard />
      </section>

      <section className="mt-10 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
        <p className="text-sm leading-relaxed text-neutral-700">
          짐툴은 운동하는 사람들을 위한 기록, 몸평, 소개팅 기능을 한곳에 모아 둔 서비스입니다.
        </p>
      </section>
    </main>
  );
}

function HomeSectionSkeleton({ className }: { className?: string }) {
  return (
    <section
      className={`mb-5 overflow-hidden rounded-3xl border border-neutral-200 bg-white/80 p-4 shadow-sm ${className ?? ""}`}
      aria-hidden
    >
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded bg-neutral-200" />
        <div className="h-7 w-3/4 rounded bg-neutral-200" />
        <div className="h-4 w-full rounded bg-neutral-100" />
        <div className="h-4 w-5/6 rounded bg-neutral-100" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-20 rounded-2xl bg-neutral-100" />
          <div className="h-20 rounded-2xl bg-neutral-100" />
        </div>
      </div>
    </section>
  );
}
