"use client";

import { useState } from "react";
import type { ReactNode } from "react";

type Tone = "soft" | "plain" | "fun";
type Scene = "back" | "leg" | "cardio" | "protein";

const TONES: Array<{ key: Tone; label: string }> = [
  { key: "soft", label: "귀엽게" },
  { key: "plain", label: "담백하게" },
  { key: "fun", label: "장난스럽게" },
];

const SCENES: Array<{ key: Scene; label: string }> = [
  { key: "back", label: "등" },
  { key: "leg", label: "하체" },
  { key: "cardio", label: "유산소" },
  { key: "protein", label: "프로틴" },
];

const LINES: Record<Tone, Record<Scene, string[]>> = {
  soft: {
    back: [
      "혹시 오늘 등 하는 날이에요? 제 마음도 같이 당겨졌는데요.",
      "등 운동 루틴이 궁금해서요. 잠깐 물어봐도 괜찮을까요?",
    ],
    leg: [
      "오늘 하체 하세요? 저는 방금 말 걸 용기까지 스쿼트하고 왔어요.",
      "하체 루틴 멋있네요. 저도 한 걸음 다가가도 될까요?",
    ],
    cardio: [
      "유산소 중이신데 죄송해요. 제 마음도 같이 뛰어서요.",
      "오늘 페이스 좋아 보여요. 짧게 인사드려도 될까요?",
    ],
    protein: [
      "혹시 프로틴 뭐 드세요? 저는 오늘 용기 한 스쿱 먹고 왔어요.",
      "프로틴보다 궁금한 게 생겼는데, 이름 물어봐도 될까요?",
    ],
  },
  plain: {
    back: [
      "등 운동 자세가 좋아 보여서요. 루틴 하나만 물어봐도 될까요?",
      "운동 되게 꾸준히 하시는 느낌이에요. 보기 좋네요.",
    ],
    leg: [
      "하체 운동 열심히 하시네요. 루틴이 깔끔해 보여요.",
      "자세가 좋아 보여서 눈에 들어왔어요. 팁 하나만 물어봐도 될까요?",
    ],
    cardio: [
      "페이스가 안정적이시네요. 운동 자주 오시나 봐요.",
      "유산소 루틴 좋아 보여요. 몇 분 정도 타시는지 궁금했어요.",
    ],
    protein: [
      "프로틴 추천 괜찮으세요? 고르다가 계속 실패해서요.",
      "운동 후에 뭐 챙겨 드시는지 궁금했어요.",
    ],
  },
  fun: {
    back: [
      "오늘 등 운동이세요? 저는 방금 호감이 풀업됐어요.",
      "랫풀다운 하시는 줄 알았는데 제 시선까지 같이 당겨졌네요.",
    ],
    leg: [
      "레그프레스 무게보다 말 걸 용기가 더 무겁네요.",
      "스쿼트보다 어려운 게 말 걸기였는데, 방금 성공한 것 같아요.",
    ],
    cardio: [
      "유산소는 그쪽이 하는데 왜 제 심박수가 올라가죠?",
      "러닝머신 속도보다 제 심박수가 더 빨라진 것 같아요.",
    ],
    protein: [
      "보충제는 챙기셨나요? 저는 용기 보충하고 왔어요.",
      "프로틴 맛 추천 하나랑, 괜찮으면 대화 한 번만 얻어가도 될까요?",
    ],
  },
};

function pickLine(tone: Tone, scene: Scene) {
  const list = LINES[tone][scene];
  return list[Math.floor(Math.random() * list.length)];
}

export default function FlirtingGeneratorClient() {
  const [tone, setTone] = useState<Tone>("soft");
  const [scene, setScene] = useState<Scene>("back");
  const [line, setLine] = useState(() => LINES.soft.back[0]);
  const [copied, setCopied] = useState(false);

  const generate = () => {
    setCopied(false);
    setLine(pickLine(tone, scene));
  };

  const copy = async () => {
    await navigator.clipboard.writeText(line);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <section className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
        <div>
          <span className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-600">ADMIN ONLY</span>
          <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-950">헬스장 플러팅 대사</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500">정치, 종교, 성적 표현 없이 가벼운 헬스장 농담만 뽑아요.</p>
        </div>

        <div className="mt-5 space-y-4">
          <SimplePicker title="톤">
            {TONES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTone(item.key)}
                className={`min-h-[40px] rounded-full border px-4 text-sm font-bold transition ${
                  tone === item.key ? "border-neutral-950 bg-neutral-950 text-white" : "border-black/5 bg-neutral-50 text-neutral-600"
                }`}
              >
                {item.label}
              </button>
            ))}
          </SimplePicker>

          <SimplePicker title="상황">
            {SCENES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setScene(item.key)}
                className={`min-h-[40px] rounded-full border px-4 text-sm font-bold transition ${
                  scene === item.key ? "border-rose-600 bg-rose-600 text-white" : "border-black/5 bg-neutral-50 text-neutral-600"
                }`}
              >
                {item.label}
              </button>
            ))}
          </SimplePicker>
        </div>

        <div className="mt-5 rounded-3xl bg-neutral-50 p-5">
          <p className="text-lg font-black leading-8 text-neutral-950">{line}</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={generate} className="min-h-[48px] rounded-2xl bg-neutral-950 px-4 text-sm font-black text-white">
            새로 뽑기
          </button>
          <button type="button" onClick={() => void copy()} className="min-h-[48px] rounded-2xl border border-neutral-200 px-4 text-sm font-black text-neutral-700">
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
      </section>
    </main>
  );
}

function SimplePicker({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-black text-neutral-900">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
