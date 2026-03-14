import Link from "next/link";
import WeeklyTopBanner from "@/components/WeeklyTopBanner";
import HomeBodyBattleQuickVote from "@/components/HomeBodyBattleQuickVote";

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
    description: "중량과 반복 횟수로 1RM 추정값을 계산합니다.",
    accent: "bg-emerald-50 border-emerald-200 hover:border-emerald-400",
    main: true,
    cta: "계산 시작",
  },
  {
    id: "lifts",
    href: "/lifts",
    title: "3대 합계 계산기",
    emoji: "📊",
    description: "스쿼트, 벤치, 데드 합계를 계산하고 기준 기록을 확인합니다.",
    accent: "bg-rose-50 border-rose-200 hover:border-rose-400",
    cta: "합계 계산하기",
  },
  {
    id: "photo_bodycheck",
    href: "/community/bodycheck",
    title: "사진 몸평 게시판",
    emoji: "📸",
    description: "사진과 글을 올리고 다른 사람들의 몸평을 받아보세요.",
    accent: "bg-indigo-50 border-indigo-200 hover:border-indigo-400",
    cta: "몸평 보러가기",
  },
  {
    id: "bodybattle",
    href: "/bodybattle",
    title: "BodyBattle",
    emoji: "🔥",
    description: "운동 사진 A/B 투표",
    accent: "bg-orange-50 border-orange-200 hover:border-orange-400",
    cta: "배틀 시작",
  },
  {
    id: "dating",
    href: "/community/dating",
    title: "소개팅",
    emoji: "💘",
    description: "오픈카드 소개팅",
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
    description: "영상 검증 후 QR 인증서(PDF)를 발급합니다.",
    accent: "bg-lime-50 border-lime-200 hover:border-lime-400",
    cta: "인증 요청하기",
  },
  {
    id: "helltest",
    href: "/helltest",
    title: "헬스 성격 테스트",
    emoji: "🧪",
    description: "20문항으로 알아보는 나의 운동 성향 테스트",
    accent: "bg-amber-50 border-amber-200 hover:border-amber-400",
    cta: "테스트 시작",
  },
  {
    id: "dating_1on1",
    href: "/dating/1on1",
    title: "1:1 스페셜 소개팅",
    emoji: "💞",
    description: "운영자가 직접 매칭해주는 1:1 소개팅 신청",
    accent: "bg-blue-50 border-blue-200 hover:border-blue-400",
    cta: "1:1 소개팅 이동",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <WeeklyTopBanner />
      <HomeBodyBattleQuickVote />

      <section className="mb-10 text-center">
        <h1 className="mb-2 text-3xl font-bold text-neutral-900">짐톡 (GymTools)</h1>
        <p className="text-base text-neutral-500">운동 계산기, 몸평, 테스트를 한곳에서.</p>
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
          ) : null
        )}
      </section>

      <section className="mt-10 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
        <p className="text-sm leading-relaxed text-neutral-700">
          짐톡(GymTools)은 운동하는 사람을 위한 1RM 계산기, 3대 합계 계산기, 성향 테스트, 몸평 게시판을 제공합니다.
        </p>
      </section>
    </main>
  );
}
