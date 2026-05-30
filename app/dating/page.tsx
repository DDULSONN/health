import Link from "next/link";

const FEATURE_CARDS = [
  {
    title: "오픈카드로 가볍게 둘러보기",
    description: "공개된 소개팅 카드를 보고 마음에 드는 사람에게 바로 지원할 수 있어요.",
  },
  {
    title: "1:1 소개팅으로 신중하게 보기",
    description: "원하는 조건에 맞춰 추천 후보를 확인하고, 서로 수락한 뒤 다음 단계로 넘어갑니다.",
  },
  {
    title: "번호 공개 전 개인정보 보호",
    description: "상호 수락과 확인 절차 전에는 연락처가 바로 공개되지 않도록 운영합니다.",
  },
];

const FAQS = [
  {
    question: "짐툴 소개팅은 운동하는 사람만 이용하나요?",
    answer: "운동을 좋아하는 사람이 많지만, 꼭 운동 특화로만 이용할 필요는 없어요. 일상적인 소개팅처럼 부담 없이 둘러볼 수 있습니다.",
  },
  {
    question: "오픈카드와 1:1 소개팅은 뭐가 다른가요?",
    answer: "오픈카드는 공개된 카드를 보고 바로 지원하는 방식이고, 1:1 소개팅은 추천 후보를 더 신중하게 확인하는 방식입니다.",
  },
  {
    question: "연락처는 바로 공개되나요?",
    answer: "아니요. 번호 공개 전까지 개인정보 보호를 우선하며, 상호 수락과 필요한 확인 절차 이후에만 다음 단계로 진행됩니다.",
  },
  {
    question: "후보가 계속 비슷하게 보이지 않나요?",
    answer: "1:1 소개팅 후보는 지역, 나이, 최근 노출 여부를 반영해 더 다양한 사람을 볼 수 있도록 계속 개선하고 있습니다.",
  },
];

export default function DatingLandingPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <main className="bg-white text-neutral-950">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="mx-auto max-w-5xl px-4 py-10 md:py-16">
        <div className="max-w-3xl">
          <span className="inline-flex rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600">
            소개팅
          </span>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight md:text-5xl">
            부담 없이 둘러보고 자연스럽게 연결되는 짐툴 소개팅
          </h1>
          <p className="mt-5 text-base font-semibold leading-8 text-neutral-600 md:text-lg">
            짐툴은 오픈카드와 1:1 소개팅으로 원하는 방식에 맞게 만남을 시작할 수 있는 소개팅 서비스입니다.
            공개된 카드를 보고 가볍게 지원하거나, 추천 후보를 신중하게 확인해보세요.
          </p>
          <div className="mt-7 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/community/dating/cards"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-rose-600 px-5 text-sm font-black text-white shadow-[0_12px_30px_rgba(225,29,72,0.18)]"
            >
              오픈카드 둘러보기
            </Link>
            <Link
              href="/mypage"
              className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-neutral-200 bg-white px-5 text-sm font-black text-neutral-800"
            >
              1:1 소개팅 시작하기
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-neutral-100 bg-neutral-50">
        <div className="mx-auto grid max-w-5xl gap-3 px-4 py-8 md:grid-cols-3">
          {FEATURE_CARDS.map((item) => (
            <article key={item.title} className="rounded-3xl border border-black/5 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
              <h2 className="text-lg font-black text-neutral-950">{item.title}</h2>
              <p className="mt-3 text-sm font-semibold leading-7 text-neutral-600">{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-4 py-10 md:grid-cols-[0.9fr_1.1fr] md:py-14">
        <div>
          <h2 className="text-2xl font-black tracking-tight md:text-3xl">어떤 방식으로 이용하나요?</h2>
          <p className="mt-3 text-sm font-semibold leading-7 text-neutral-600">
            처음에는 오픈카드로 분위기를 둘러보고, 더 신중한 만남을 원하면 1:1 소개팅으로 후보를 확인할 수 있어요.
            짐툴은 운동을 좋아하는 사람뿐 아니라 자연스러운 소개팅을 원하는 사람도 이용할 수 있게 운영됩니다.
          </p>
        </div>
        <div className="space-y-3">
          {[
            "오픈카드에서 공개된 소개팅 카드 확인",
            "마음에 드는 카드에 지원하거나 내 카드 공개",
            "1:1 소개팅에서 다양한 후보 확인",
            "서로 수락하면 다음 단계로 안전하게 진행",
          ].map((step, index) => (
            <div key={step} className="flex gap-3 rounded-2xl border border-neutral-100 bg-white p-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-sm font-black text-white">
                {index + 1}
              </span>
              <p className="pt-1 text-sm font-bold leading-6 text-neutral-800">{step}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-neutral-950 text-white">
        <div className="mx-auto max-w-5xl px-4 py-10 md:py-14">
          <h2 className="text-2xl font-black tracking-tight md:text-3xl">자주 묻는 질문</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {FAQS.map((item) => (
              <article key={item.question} className="rounded-3xl border border-white/10 bg-white/[0.06] p-5">
                <h3 className="text-base font-black text-white">{item.question}</h3>
                <p className="mt-3 text-sm font-semibold leading-7 text-white/70">{item.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
