import Link from "next/link";
// import DailyMissionsWidget from "@/components/DailyMissionsWidget";
import MyWeeklyRankCard from "@/components/MyWeeklyRankCard";
import WeeklyTopBanner from "@/components/WeeklyTopBanner";

type Feature = {
  id: string;
  href?: string;
  title: string;
  emoji: string;
  description: string;
  accent: string;
  cta?: string;
  main?: boolean;
  disabled?: boolean;
};

const FEATURES: Feature[] = [
  {
    id: "photo_bodycheck",
    href: "/community/bodycheck",
    title: "사진 몸평 게시판",
    emoji: "📸",
    description: "사진과 글을 올리고 유저들의 몸평을 받아보세요.",
    accent: "bg-indigo-50 border-indigo-200 hover:border-indigo-400",
    cta: "몸평 보러가기",
  },
  {
    id: "one_rm",
    href: "/1rm",
    title: "1RM 계산기",
    emoji: "🏋️",
    description: "작업 중량과 반복 횟수로 1RM 추정값을 계산합니다.",
    accent: "bg-emerald-50 border-emerald-200 hover:border-emerald-400",
    main: true,
    cta: "계산 시작",
  },
  {
    id: "lifts",
    href: "/lifts",
    title: "3대 합계 계산기",
    emoji: "🏆",
    description: "스쿼트·벤치·데드 합계와 체급 기준 상위%를 확인합니다.",
    accent: "bg-rose-50 border-rose-200 hover:border-rose-400",
    cta: "합계 계산하기",
  },
  {
    id: "certify",
    href: "/certify",
    title: "3대 공식 인증",
    emoji: "✅",
    description: "영상 검증 후 QR 인증서(PDF) 발급",
    accent: "bg-lime-50 border-lime-200 hover:border-lime-400",
    cta: "인증 신청하기",
  },
  {
    id: "helltest",
    href: "/helltest",
    title: "헬창 판독기",
    emoji: "🧪",
    description: "20문항으로 알아보는 나의 헬창력 테스트",
    accent: "bg-amber-50 border-amber-200 hover:border-amber-400",
    cta: "테스트 시작",
  },
  {
    id: "snacks",
    href: "/snacks",
    title: "다이어트 간식",
    emoji: "🥗",
    description: "운동과 식단에 맞는 간식을 추천합니다.",
    accent: "bg-blue-50 border-blue-200 hover:border-blue-400",
    cta: "간식 보기",
  },
  {
    id: "community",
    href: "/community",
    title: "커뮤니티",
    emoji: "💬",
    description: "운동 기록과 노하우를 공유하는 공간입니다.",
    accent: "bg-cyan-50 border-cyan-200 hover:border-cyan-400",
    cta: "커뮤니티 이동",
  },
];

export default function HomePage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <WeeklyTopBanner />
      {/* <DailyMissionsWidget /> */}
      <MyWeeklyRankCard />

      <section className="text-center mb-10">
        <h1 className="text-3xl font-bold text-neutral-900 mb-2">짐툴 (GymTools)</h1>
        <p className="text-neutral-500 text-base">헬스 계산기 · 몸평 · 헬창 판독</p>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FEATURES.map((feature) =>
          feature.href && !feature.disabled ? (
            <Link
              key={feature.id}
              href={feature.href}
              className={`group block rounded-2xl border-2 p-5 transition-all active:scale-[0.99] ${feature.accent} ${
                feature.main ? "ring-2 ring-emerald-300 ring-offset-1" : ""
              }`}
            >
              <div className="flex items-start gap-4">
                <span className="text-3xl shrink-0" aria-hidden>
                  {feature.emoji}
                </span>
                <div className="min-w-0 w-full">
                  <h2 className="text-lg font-bold text-neutral-900 group-hover:text-emerald-700 transition-colors">
                    {feature.title}
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600 leading-relaxed">{feature.description}</p>
                  {feature.cta && (
                    <p className="mt-3 text-xs font-semibold text-emerald-700">
                      {feature.cta}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ) : null,
        )}
      </section>

      <section className="mt-10 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
        <p className="text-sm leading-relaxed text-neutral-700">
          짐툴(GymTools)은 헬스 유저를 위한 1RM 계산기, 3대 합계 계산기, 헬창 판독기와 몸평 게시판을 제공하는 사이트입니다.
        </p>
      </section>
    </main>
  );
}

