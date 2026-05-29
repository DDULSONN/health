import Link from "next/link";

const TOOLS = [
  {
    href: "/flirting-generator",
    title: "헬스장 플러팅 대사",
    description: "가볍게 웃을 수 있는 헬스장 멘트",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 12h10M8 8h8M6 16h6M5 21l2.5-3H18a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3" />
      </svg>
    ),
  },
  {
    href: "/lifts",
    title: "3대 합계 계산기",
    description: "스쿼트, 벤치, 데드 합계와 등급 확인",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16M2 9v6M22 9v6M7 8v8M17 8v8" />
      </svg>
    ),
  },
  {
    href: "/1rm",
    title: "1RM 계산기",
    description: "반복 횟수로 예상 1RM 계산",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 19V5M5 19h14M8 16l3-3 2 2 5-6" />
      </svg>
    ),
  },
  {
    href: "/certify",
    title: "3대 인증 신청",
    description: "기록을 제출하고 인증 배지 받기",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.2 2.2 4.8-5.4M12 3l7 3v5c0 4.4-2.8 8-7 10-4.2-2-7-5.6-7-10V6l7-3Z" />
      </svg>
    ),
  },
];

export default function ToolsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:py-12">
      <section className="rounded-[30px] border border-black/5 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] md:p-8">
        <span className="inline-flex rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600">도구</span>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-neutral-950 md:text-4xl">짐툴 도구</h1>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group flex min-h-[128px] items-center gap-4 rounded-[24px] border border-black/5 bg-neutral-50 p-4 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)]"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-rose-600 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition group-hover:bg-rose-600 group-hover:text-white">
                {tool.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-base font-black text-neutral-950">{tool.title}</span>
                <span className="mt-1 block text-sm leading-6 text-neutral-500">{tool.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
