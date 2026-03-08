import Link from "next/link";
// import DailyMissionsWidget from "@/components/DailyMissionsWidget";
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
    emoji: "📈",
    description: "스쿼트/벤치/데드 합계를 계산하고 상위 퍼센트를 확인합니다.",
    accent: "bg-rose-50 border-rose-200 hover:border-rose-400",
    cta: "합계 계산하기",
  },
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
    id: "bodybattle",
    href: "/bodybattle",
    title: "BodyBattle",
    emoji: "🥇",
    description: "주간 부위 챔피언전 A/B 투표 랭킹전",
    accent: "bg-orange-50 border-orange-200 hover:border-orange-400",
    cta: "배틀 시작",
  },
  {
    id: "dating",
    href: "/community/dating",
    title: "소개팅",
    emoji: "💘",
    description: "3대 인증자 소개팅 카드 열람 및 지원",
    accent: "bg-pink-50 border-pink-200 hover:border-pink-400",
    cta: "소개팅 보기",
  },
  {
    id: "community",
    href: "/community",
    title: "커뮤니티",
    emoji: "💬",
    description: "운동 기록과 후기를 공유하는 공간입니다.",
    accent: "bg-cyan-50 border-cyan-200 hover:border-cyan-400",
    cta: "커뮤니티 이동",
  },
  {
    id: "certify",
    href: "/certify",
    title: "3대 공식 인증",
    emoji: "✅",
    description: "영상 검증 후 QR 인증서(PDF) 발급",
    accent: "bg-lime-50 border-lime-200 hover:border-lime-400",
    cta: "인증 요청하기",
  },
  {
    id: "helltest",
    href: "/helltest",
    title: "헬스 성격 테스트",
    emoji: "🧠",
    description: "20문항으로 알아보는 나의 운동 성향 테스트",
    accent: "bg-amber-50 border-amber-200 hover:border-amber-400",
    cta: "테스트 시작",
  },
  {
    id: "dating_1on1",
    href: "/dating/1on1",
    title: "1:1 오프라인 소개팅",
    emoji: "🤝",
    description: "운영자가 직접 매칭하는 오프라인 소개팅 신청",
    accent: "bg-blue-50 border-blue-200 hover:border-blue-400",
    cta: "1:1 소개팅 이동",
  },
];

export default function HomePage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <WeeklyTopBanner />
      <section className="mb-5 rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-orange-800">BodyBattle 투표</p>
            <p className="mt-1 text-xs text-neutral-600">이번 주 부위 챔피언전 A/B 투표에 바로 참여하세요.</p>
          </div>
          <Link
            href="/bodybattle"
            className="shrink-0 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-700"
          >
            투표 시작
          </Link>
        </div>
      </section>
      {/* <DailyMissionsWidget /> */}

      <section className="text-center mb-10">
        <h1 className="text-3xl font-bold text-neutral-900 mb-2">짐툴 (GymTools)</h1>
        <p className="text-neutral-500 text-base">헬스 계산기 · 몸평 · 테스트</p>
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
                  {feature.cta && <p className="mt-3 text-xs font-semibold text-emerald-700">{feature.cta}</p>}
                </div>
              </div>
            </Link>
          ) : null,
        )}
      </section>

      <section className="mt-10 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
        <p className="text-sm leading-relaxed text-neutral-700">
          짐툴(GymTools)은 헬스 유저를 위한 1RM 계산기, 3대 합계 계산기, 성격 테스트, 몸평 게시판을 제공합니다.
        </p>
      </section>
    </main>
  );
}
