"use client";

import { useMemo, useState } from "react";

type Mood = "cute" | "calm" | "bold";
type Scene = "back" | "leg" | "cardio" | "stretch" | "protein";

const MOODS: Array<{ key: Mood; label: string; hint: string }> = [
  { key: "cute", label: "귀엽게", hint: "부담 적은 장난 톤" },
  { key: "calm", label: "담백하게", hint: "오글거림 적게" },
  { key: "bold", label: "조금 과감", hint: "그래도 선은 지키기" },
];

const SCENES: Array<{ key: Scene; label: string }> = [
  { key: "back", label: "등" },
  { key: "leg", label: "하체" },
  { key: "cardio", label: "유산소" },
  { key: "stretch", label: "스트레칭" },
  { key: "protein", label: "보충제" },
];

const LINES: Record<Mood, Record<Scene, string[]>> = {
  cute: {
    back: [
      "혹시 오늘 등 하는 날이에요? 제 마음도 같이 당겨졌는데요.",
      "랫풀다운 하시는 줄 알았는데 제 시선까지 같이 끌어내리시네요.",
      "등 운동 루틴이 궁금한데요. 마음 넓어지는 비법도 같이 있나요?",
    ],
    leg: [
      "오늘 하체 하세요? 저는 방금 용기까지 스쿼트하고 왔어요.",
      "레그프레스 무게보다 말 걸 용기가 더 무겁네요.",
      "하체 루틴 멋있네요. 저도 오늘은 한 걸음 더 다가가도 될까요?",
    ],
    cardio: [
      "러닝머신 속도보다 제 심박수가 더 빨라진 것 같아요.",
      "유산소 중이신데 죄송해요. 제 마음도 같이 뛰어서요.",
      "오늘 페이스 좋으시네요. 저도 대화 페이스 맞춰봐도 될까요?",
    ],
    stretch: [
      "스트레칭 되게 차분하게 하시네요. 분위기까지 풀리는 느낌이에요.",
      "유연성이 부럽네요. 저는 말 걸 타이밍만 좀 굳어 있었어요.",
      "쿨다운 중이세요? 저는 방금 마음이 워밍업됐어요.",
    ],
    protein: [
      "혹시 단백질 뭐 드세요? 저는 오늘 용기 한 스쿱 먹고 왔어요.",
      "프로틴보다 더 궁금한 게 생겼는데, 이름 물어봐도 될까요?",
      "쉐이크 맛 추천도 좋고, 대화 맛보기 한 번도 좋을 것 같아요.",
    ],
  },
  calm: {
    back: [
      "등 운동 자세가 좋아 보여서요. 혹시 루틴 물어봐도 괜찮을까요?",
      "운동 되게 꾸준히 하시는 느낌이에요. 보기 좋네요.",
      "방해가 아니라면 등 루틴 하나만 추천받아도 될까요?",
    ],
    leg: [
      "하체 운동 열심히 하시네요. 루틴이 깔끔해 보여요.",
      "자세가 좋아 보여서 눈에 들어왔어요. 팁 하나만 물어봐도 될까요?",
      "오늘 운동 분위기 좋으시네요. 짧게 인사드리고 싶었어요.",
    ],
    cardio: [
      "페이스 되게 안정적이시네요. 운동 자주 오시나 봐요.",
      "유산소 루틴 좋아 보여요. 몇 분 정도 타시는지 궁금했어요.",
      "운동 집중하시는 모습이 좋아 보여서 짧게 인사드려요.",
    ],
    stretch: [
      "스트레칭 루틴 좋아 보여요. 따라 해봐도 될까요?",
      "운동 마무리까지 챙기시는 게 멋있네요.",
      "분위기가 차분해서 말 걸기 편해 보였어요. 잠깐 괜찮으세요?",
    ],
    protein: [
      "프로틴 추천 괜찮으세요? 고르다가 계속 실패해서요.",
      "운동 후에 뭐 챙겨 드시는지 궁금했어요.",
      "보충제 잘 아시는 것 같아서 짧게 물어봐도 될까요?",
    ],
  },
  bold: {
    back: [
      "오늘 등 운동이세요? 저는 방금 호감이 풀업됐어요.",
      "등이 넓으신데, 대화 자리도 조금만 넓혀주실 수 있나요?",
      "운동 루틴도 궁금하고, 솔직히 한 번 더 보고 싶어서요.",
    ],
    leg: [
      "하체 루틴 멋있네요. 저도 오늘은 마음이 한 세트 더 남았어요.",
      "스쿼트보다 어려운 게 말 걸기였는데, 방금 성공한 것 같아요.",
      "운동 끝나고 물 한 잔 타이밍에 짧게 얘기해도 될까요?",
    ],
    cardio: [
      "유산소는 그쪽이 하는데 왜 제 심박수가 올라가죠?",
      "페이스 좋으시네요. 저도 대화는 천천히 맞춰볼게요.",
      "러닝 끝나면 숨 고르실 때 인사 한 번 더 해도 될까요?",
    ],
    stretch: [
      "스트레칭처럼 자연스럽게 말 걸고 싶었는데, 생각보다 떨리네요.",
      "유연한 사람은 대화도 잘 받아주시나요?",
      "운동 마무리 중이신데, 제 하루 시작은 지금인 것 같아요.",
    ],
    protein: [
      "프로틴보다 오늘 제일 효과 좋은 건 방금 본 미소였어요.",
      "보충제는 챙기셨나요? 저는 용기 보충하고 왔어요.",
      "맛 추천 하나랑, 괜찮으면 대화 한 번만 얻어가도 될까요?",
    ],
  },
};

const SAFETY_NOTE = "정치, 종교, 성적 표현 없이 헬스장 상황 농담만 사용해요.";

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildLines(mood: Mood, scene: Scene) {
  const selected = [...LINES[mood][scene]];
  const mixed = Object.values(LINES[mood]).flat().filter((line) => !selected.includes(line));
  while (selected.length < 5 && mixed.length > 0) {
    const next = pickRandom(mixed);
    selected.push(next);
    mixed.splice(mixed.indexOf(next), 1);
  }
  return selected.sort(() => Math.random() - 0.5).slice(0, 5);
}

export default function FlirtingGeneratorClient() {
  const [mood, setMood] = useState<Mood>("cute");
  const [scene, setScene] = useState<Scene>("back");
  const [lines, setLines] = useState(() => LINES.cute.back);
  const [copied, setCopied] = useState<string | null>(null);

  const selectedMood = useMemo(() => MOODS.find((item) => item.key === mood) ?? MOODS[0], [mood]);

  const regenerate = () => {
    setCopied(null);
    setLines(buildLines(mood, scene));
  };

  const selectMood = (nextMood: Mood) => {
    setMood(nextMood);
    setCopied(null);
    setLines(buildLines(nextMood, scene));
  };

  const selectScene = (nextScene: Scene) => {
    setScene(nextScene);
    setCopied(null);
    setLines(buildLines(mood, nextScene));
  };

  const copyLine = async (line: string) => {
    await navigator.clipboard.writeText(line);
    setCopied(line);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:py-12">
      <section className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-600">ADMIN ONLY</div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-neutral-950 md:text-4xl">헬스장 플러팅 대사 생성기</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">{SAFETY_NOTE}</p>
          </div>
          <button
            type="button"
            onClick={regenerate}
            className="inline-flex min-h-[50px] items-center justify-center rounded-2xl bg-neutral-950 px-5 text-sm font-black text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)] transition hover:bg-black"
          >
            새로 뽑기
          </button>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="rounded-3xl bg-neutral-50 p-4">
            <p className="text-sm font-black text-neutral-900">톤</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {MOODS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => selectMood(item.key)}
                  className={`rounded-2xl border px-3 py-3 text-left transition ${
                    mood === item.key ? "border-neutral-950 bg-neutral-950 text-white" : "border-black/5 bg-white text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  <span className="block text-sm font-black">{item.label}</span>
                  <span className={`mt-1 block text-[11px] font-semibold ${mood === item.key ? "text-white/65" : "text-neutral-400"}`}>{item.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-neutral-50 p-4">
            <p className="text-sm font-black text-neutral-900">상황</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SCENES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => selectScene(item.key)}
                  className={`min-h-[40px] rounded-full border px-4 text-sm font-bold transition ${
                    scene === item.key ? "border-rose-600 bg-rose-600 text-white" : "border-black/5 bg-white text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold text-neutral-400">현재 톤: {selectedMood.label}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          {lines.map((line, index) => (
            <div key={`${line}-${index}`} className="flex flex-col gap-3 rounded-3xl border border-black/5 bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,0.04)] md:flex-row md:items-center md:justify-between">
              <p className="text-[17px] font-bold leading-8 text-neutral-900 md:text-lg">{line}</p>
              <button
                type="button"
                onClick={() => void copyLine(line)}
                className="inline-flex min-h-[42px] shrink-0 items-center justify-center rounded-2xl border border-neutral-200 px-4 text-sm font-black text-neutral-700 transition hover:bg-neutral-50"
              >
                {copied === line ? "복사됨" : "복사"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
