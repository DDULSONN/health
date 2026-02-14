import Link from "next/link";

type Feature = {
  id: string;
  href?: string;
  title: string;
  emoji: string;
  description: string;
  accent: string;
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
  },
  {
    id: "one_rm",
    href: "/1rm",
    title: "1RM 계산기",
    emoji: "🏋️",
    description: "무게와 반복 횟수로 1RM을 추정하고 훈련 중량까지 계산합니다.",
    accent: "bg-emerald-50 border-emerald-200 hover:border-emerald-400",
    main: true,
  },
  {
    id: "lifts",
    href: "/lifts",
    title: "3대 합계 계산기",
    emoji: "🏆",
    description: "스쿼트, 벤치, 데드리프트의 합계와 체중 대비 비율을 확인합니다.",
    accent: "bg-rose-50 border-rose-200 hover:border-rose-400",
  },
  {
    id: "helltest",
    href: "/helltest",
    title: "헬창 판독기",
    emoji: "🧪",
    description: "20문항으로 알아보는 나의 헬창력 테스트",
    accent: "bg-amber-50 border-amber-200 hover:border-amber-400",
  },
  {
    id: "snacks",
    href: "/snacks",
    title: "다이어트 간식",
    emoji: "🍪",
    description: "운동 전후와 식단 보완에 도움 되는 간식을 추천합니다.",
    accent: "bg-blue-50 border-blue-200 hover:border-blue-400",
  },
  {
    id: "community",
    href: "/community",
    title: "커뮤니티",
    emoji: "💬",
    description: "운동 기록을 공유하고 서로의 노하우를 나눠보세요.",
    accent: "bg-cyan-50 border-cyan-200 hover:border-cyan-400",
  },
  {
    id: "ad_placeholder",
    title: "AD",
    emoji: "📢",
    description: "광고 영역",
    accent: "bg-neutral-100 border-neutral-200",
    disabled: true,
  },
];

export default function HomePage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <section className="text-center mb-10">
        <h1 className="text-3xl font-bold text-neutral-900 mb-2">짐툴 (GymTools)</h1>
        <p className="text-neutral-500 text-base">헬스 계산기 · 몸평 · 헬창 판독</p>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FEATURES.map((f) =>
          f.href && !f.disabled ? (
            <Link
              key={f.id}
              href={f.href}
              className={`group block rounded-2xl border-2 p-5 transition-all active:scale-[0.99] ${f.accent} ${
                f.main ? "ring-2 ring-emerald-300 ring-offset-1" : ""
              }`}
            >
              <div className="flex items-start gap-4">
                <span className="text-3xl shrink-0" aria-hidden>
                  {f.emoji}
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-neutral-900 group-hover:text-emerald-700 transition-colors">
                    {f.title}
                    {f.main && (
                      <span className="ml-2 text-xs font-medium text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full align-middle">
                        MAIN
                      </span>
                    )}
                  </h2>
                  <p className="mt-1 text-sm text-neutral-600 leading-relaxed">{f.description}</p>
                </div>
              </div>
            </Link>
          ) : (
            <div
              key={f.id}
              className={`rounded-2xl border-2 p-5 opacity-70 select-none ${f.accent}`}
              aria-disabled="true"
            >
              <div className="flex items-start gap-4">
                <span className="text-3xl shrink-0" aria-hidden>
                  {f.emoji}
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-neutral-700">{f.title}</h2>
                  <p className="mt-1 text-sm text-neutral-500 leading-relaxed">{f.description}</p>
                </div>
              </div>
            </div>
          ),
        )}
      </section>

      <section className="mt-10 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
        <p className="text-sm leading-relaxed text-neutral-700">
          짐툴(GymTools)은 헬스 유저를 위한 1RM 계산기, 3대 합계 계산기, 헬창 판독기와 몸평
          게시판을 제공하는 사이트입니다.
        </p>
      </section>

      <div className="mt-8 pt-4 border-t border-neutral-200">
        <p className="text-xs text-neutral-400 text-center">
          모든 데이터는 브라우저(localStorage)와 서비스 DB에 안전하게 저장됩니다.
        </p>
      </div>
    </main>
  );
}
