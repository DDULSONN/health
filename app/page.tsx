import Link from "next/link";

const FEATURES = [
  {
    href: "/1rm",
    title: "1RM 계산기",
    emoji: "🏋️",
    description: "중량과 반복 횟수로 1RM을 추정하고, 퍼센트별 작업 중량표까지",
    accent: "bg-emerald-50 border-emerald-200 hover:border-emerald-400",
    main: true,
  },
  {
    href: "/helltest",
    title: "헬창 판독기",
    emoji: "🏆",
    description: "20문항으로 알아보는 나의 헬스 유형 테스트",
    accent: "bg-amber-50 border-amber-200 hover:border-amber-400",
  },
  {
    href: "/snacks",
    title: "다이어트 간식",
    emoji: "🍫",
    description: "프로틴바 맛있는 순 랭킹 & 프로틴 보충제 추천 모음",
    accent: "bg-blue-50 border-blue-200 hover:border-blue-400",
  },
  {
    href: "/bodycheck",
    title: "몸평가",
    emoji: "📊",
    description: "10문항 설문으로 나에게 맞는 운동 방향 진단",
    accent: "bg-purple-50 border-purple-200 hover:border-purple-400",
  },
  {
    href: "/lifts",
    title: "3대 합계 계산기",
    emoji: "💪",
    description: "스쿼트/벤치/데드 합계와 체중 대비 등급 확인",
    accent: "bg-rose-50 border-rose-200 hover:border-rose-400",
  },
];

export default function HomePage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      {/* Hero */}
      <section className="text-center mb-10">
        <h1 className="text-3xl font-bold text-neutral-900 mb-2">
          GymTools
        </h1>
        <p className="text-neutral-500 text-base">
          헬스인을 위한 올인원 도구 모음
        </p>
      </section>

      {/* Community CTA */}
      <Link
        href="/community"
        className="block rounded-2xl border-2 border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-5 mb-4 hover:border-orange-400 transition-all active:scale-[0.99] group"
      >
        <div className="flex items-center gap-4">
          <span className="text-4xl shrink-0">🔥</span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-neutral-900 group-hover:text-orange-700 transition-colors">
              오늘의 헬창 커뮤니티
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              내 기록 공유하고 다른 헬창들과 소통하기
            </p>
          </div>
          <span className="ml-auto text-neutral-400 group-hover:text-orange-600 transition-colors shrink-0">→</span>
        </div>
      </Link>

      {/* Feature Cards */}
      <section className="grid gap-3">
        {FEATURES.map((f) => (
          <Link
            key={f.href}
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
                <p className="mt-1 text-sm text-neutral-600 leading-relaxed">
                  {f.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </section>

      {/* Privacy Note */}
      <div className="mt-8 pt-4 border-t border-neutral-200">
        <p className="text-xs text-neutral-400 text-center">
          모든 데이터는 브라우저(localStorage)에만 저장되며, 서버로 전송되지
          않습니다.
        </p>
      </div>
    </main>
  );
}
