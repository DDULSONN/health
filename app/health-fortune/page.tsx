"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

type Condition = "great" | "normal" | "tired";
type Mood = "burn" | "light" | "stress";
type Goal = "muscle" | "diet" | "recover" | "attendance";
type TimeSlot = "short" | "normal" | "long";

type FortuneResult = {
  title: string;
  intensity: string;
  summary: string;
  routine: string[];
  avoid: string;
  mission: string;
};

const CONDITION_OPTIONS: Array<{ key: Condition; label: string; hint: string }> = [
  { key: "great", label: "좋음", hint: "무게 욕심 조금 가능" },
  { key: "normal", label: "보통", hint: "평소 루틴으로 안정적" },
  { key: "tired", label: "피곤", hint: "관절과 회복 우선" },
];

const MOOD_OPTIONS: Array<{ key: Mood; label: string; hint: string }> = [
  { key: "burn", label: "불태우고 싶음", hint: "묵직한 메인 운동" },
  { key: "light", label: "가볍게만", hint: "출석 성공 쪽" },
  { key: "stress", label: "스트레스 해소", hint: "땀 빼고 개운하게" },
];

const GOAL_OPTIONS: Array<{ key: Goal; label: string }> = [
  { key: "muscle", label: "근성장" },
  { key: "diet", label: "다이어트" },
  { key: "recover", label: "컨디션 회복" },
  { key: "attendance", label: "그냥 출석" },
];

const TIME_OPTIONS: Array<{ key: TimeSlot; label: string }> = [
  { key: "short", label: "30분" },
  { key: "normal", label: "60분" },
  { key: "long", label: "90분" },
];

const RESULT_BANK: Record<Goal, FortuneResult[]> = {
  muscle: [
    {
      title: "등 + 이두",
      intensity: "중상",
      summary: "오늘은 밀기보다 당기는 운동이 잘 맞는 날이에요. 무게보다 등 자극을 찾으면 만족도가 높을 듯해요.",
      routine: ["랫풀다운 4세트", "시티드로우 3세트", "원암 덤벨로우 3세트", "이지바 컬 3세트"],
      avoid: "반동으로 당기기",
      mission: "마지막 세트는 3초 천천히 내리기",
    },
    {
      title: "가슴 + 삼두",
      intensity: "중상",
      summary: "오늘은 깔끔하게 미는 힘이 좋은 날이에요. 첫 운동만 집중해서 잡으면 뒤 루틴도 잘 풀릴 거예요.",
      routine: ["벤치프레스 4세트", "인클라인 덤벨프레스 3세트", "펙덱 플라이 3세트", "케이블 푸시다운 3세트"],
      avoid: "어깨가 말린 상태로 프레스",
      mission: "첫 세트 전에 가벼운 푸시업 10회",
    },
  ],
  diet: [
    {
      title: "하체 + 짧은 유산소",
      intensity: "중",
      summary: "오늘은 땀은 내되 무리하지 않는 조합이 좋아요. 하체로 열을 올리고 유산소로 정리하면 깔끔합니다.",
      routine: ["레그프레스 4세트", "레그컬 3세트", "런지 2세트", "경사 걷기 15분"],
      avoid: "처음부터 전력 질주",
      mission: "운동 후 물 500ml 챙기기",
    },
    {
      title: "전신 서킷",
      intensity: "중",
      summary: "오늘은 한 부위만 파기보다 전신을 가볍게 돌리는 흐름이 잘 맞아요. 끝나고 개운함이 남는 날입니다.",
      routine: ["고블릿 스쿼트 3세트", "랫풀다운 3세트", "덤벨 숄더프레스 3세트", "자전거 12분"],
      avoid: "쉬는 시간 길게 늘리기",
      mission: "세트 사이 휴식 70초 안쪽으로 맞추기",
    },
  ],
  recover: [
    {
      title: "어깨 안정화 + 스트레칭",
      intensity: "하",
      summary: "오늘은 몸을 더 괴롭히기보다 정렬을 맞추는 날이에요. 가볍게 해도 내일 컨디션에 도움이 됩니다.",
      routine: ["페이스풀 3세트", "사이드 레터럴 레이즈 3세트", "밴드 풀어파트 3세트", "흉추 스트레칭 8분"],
      avoid: "통증 있는 동작 밀어붙이기",
      mission: "운동 전후 목과 어깨 긴장 체크",
    },
    {
      title: "가벼운 등 + 걷기",
      intensity: "하중",
      summary: "피곤한 날엔 당기는 운동을 가볍게 가져가면 몸이 풀려요. 오늘은 출석 자체가 꽤 큰 승리입니다.",
      routine: ["암풀다운 3세트", "머신로우 3세트", "백익스텐션 2세트", "천천히 걷기 15분"],
      avoid: "고중량 데드리프트",
      mission: "운동 끝나고 5분 더 천천히 걷기",
    },
  ],
  attendance: [
    {
      title: "출석 성공 루틴",
      intensity: "하",
      summary: "오늘은 완벽한 운동보다 헬스장에 간 내가 이긴 날이에요. 짧게 끝내도 리듬은 이어집니다.",
      routine: ["가벼운 걷기 8분", "랫풀다운 3세트", "레그익스텐션 3세트", "플랭크 2세트"],
      avoid: "다 못 할 것 같아서 아예 쉬기",
      mission: "운동복 입고 헬스장 문 통과하기",
    },
    {
      title: "상체 가볍게",
      intensity: "하중",
      summary: "오늘은 깊게 파기보다 몸에 신호만 주는 루틴이 좋아요. 내일 다시 치고 나갈 여지를 남겨요.",
      routine: ["체스트프레스 3세트", "시티드로우 3세트", "사이드 레터럴 레이즈 2세트", "케이블 컬 2세트"],
      avoid: "운동 시간을 억지로 늘리기",
      mission: "딱 4종목만 하고 깔끔하게 나오기",
    },
  ],
};

function hashText(value: string) {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function buildFortune(condition: Condition, mood: Mood, goal: Goal, timeSlot: TimeSlot) {
  const bank = RESULT_BANK[goal];
  const index = hashText(`${getTodayKey()}-${condition}-${mood}-${goal}-${timeSlot}`) % bank.length;
  const base = bank[index];

  if (condition === "tired") {
    return {
      ...base,
      intensity: base.intensity === "중상" ? "중" : base.intensity,
      summary: `${base.summary} 컨디션이 낮으면 첫 운동만 제대로 해도 충분해요.`,
      avoid: `${base.avoid}, 억지 고중량`,
    };
  }

  if (mood === "burn" && condition === "great") {
    return {
      ...base,
      intensity: base.intensity === "하" ? "중" : "상",
      mission: `${base.mission} 그리고 마지막 운동 1세트 추가`,
    };
  }

  if (timeSlot === "short") {
    return {
      ...base,
      routine: base.routine.slice(0, 3),
      summary: `${base.summary} 오늘은 30분 안에 끝내는 압축 루틴으로 가면 좋아요.`,
    };
  }

  if (timeSlot === "long") {
    return {
      ...base,
      routine: [...base.routine, "마무리 유산소 10분"],
    };
  }

  return base;
}

export default function HealthFortunePage() {
  const [condition, setCondition] = useState<Condition>("normal");
  const [mood, setMood] = useState<Mood>("light");
  const [goal, setGoal] = useState<Goal>("attendance");
  const [timeSlot, setTimeSlot] = useState<TimeSlot>("normal");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => buildFortune(condition, mood, goal, timeSlot), [condition, mood, goal, timeSlot]);

  const copyResult = async () => {
    const text = [`오늘의 헬스 운세: ${result.title}`, `강도: ${result.intensity}`, result.summary, "", ...result.routine.map((item) => `- ${item}`), "", `피할 것: ${result.avoid}`, `미션: ${result.mission}`].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:py-12">
      <section className="rounded-[30px] border border-black/5 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="inline-flex rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600">오늘의 헬스 운세</span>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-neutral-950 md:text-4xl">오늘 뭐 하지?</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
              컨디션과 기분에 맞춰 오늘 할 운동을 가볍게 찝어줘요.
            </p>
          </div>
          <Link
            href="/lifts"
            className="inline-flex min-h-[48px] items-center justify-center rounded-2xl border border-neutral-200 bg-white px-5 text-sm font-black text-neutral-700 transition hover:bg-neutral-50"
          >
            3대 계산기로 이동
          </Link>
        </div>

        <div className="mt-7 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <OptionPanel title="오늘 컨디션">
              {CONDITION_OPTIONS.map((item) => (
                <ChoiceButton key={item.key} active={condition === item.key} label={item.label} hint={item.hint} onClick={() => setCondition(item.key)} />
              ))}
            </OptionPanel>

            <OptionPanel title="오늘 기분">
              {MOOD_OPTIONS.map((item) => (
                <ChoiceButton key={item.key} active={mood === item.key} label={item.label} hint={item.hint} onClick={() => setMood(item.key)} />
              ))}
            </OptionPanel>

            <div className="grid gap-4 md:grid-cols-2">
              <SmallPanel title="목표">
                {GOAL_OPTIONS.map((item) => (
                  <PillButton key={item.key} active={goal === item.key} onClick={() => setGoal(item.key)}>
                    {item.label}
                  </PillButton>
                ))}
              </SmallPanel>
              <SmallPanel title="운동 시간">
                {TIME_OPTIONS.map((item) => (
                  <PillButton key={item.key} active={timeSlot === item.key} onClick={() => setTimeSlot(item.key)}>
                    {item.label}
                  </PillButton>
                ))}
              </SmallPanel>
            </div>
          </div>

          <section className="rounded-[28px] border border-rose-100 bg-rose-50/55 p-5 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-rose-600">오늘 추천</p>
                <h2 className="mt-1 text-3xl font-black tracking-tight text-neutral-950">{result.title}</h2>
              </div>
              <span className="rounded-full bg-white px-3 py-1.5 text-sm font-black text-neutral-800 shadow-[0_8px_20px_rgba(15,23,42,0.05)]">
                강도 {result.intensity}
              </span>
            </div>

            <p className="mt-4 text-[15px] leading-7 text-neutral-700">{result.summary}</p>

            <div className="mt-5 rounded-3xl bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
              <p className="text-sm font-black text-neutral-950">추천 루틴</p>
              <ol className="mt-3 grid gap-2">
                {result.routine.map((item, index) => (
                  <li key={item} className="flex items-center gap-3 rounded-2xl bg-neutral-50 px-3 py-2 text-sm font-bold text-neutral-700">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-xs text-white">{index + 1}</span>
                    {item}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ResultNote title="오늘 피할 것" body={result.avoid} />
              <ResultNote title="보너스 미션" body={result.mission} />
            </div>

            <button
              type="button"
              onClick={() => void copyResult()}
              className="mt-5 inline-flex min-h-[50px] w-full items-center justify-center rounded-2xl bg-neutral-950 px-5 text-sm font-black text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)] transition hover:bg-black"
            >
              {copied ? "복사됨" : "결과 복사"}
            </button>
          </section>
        </div>
      </section>
    </main>
  );
}

function OptionPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[26px] border border-black/5 bg-neutral-50 p-4">
      <p className="text-sm font-black text-neutral-950">{title}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">{children}</div>
    </section>
  );
}

function SmallPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[26px] border border-black/5 bg-neutral-50 p-4">
      <p className="text-sm font-black text-neutral-950">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function ChoiceButton({ active, label, hint, onClick }: { active: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-3 py-3 text-left transition ${
        active ? "border-neutral-950 bg-neutral-950 text-white" : "border-black/5 bg-white text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      <span className="block text-sm font-black">{label}</span>
      <span className={`mt-1 block text-[11px] font-semibold ${active ? "text-white/65" : "text-neutral-400"}`}>{hint}</span>
    </button>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[40px] rounded-full border px-4 text-sm font-bold transition ${
        active ? "border-rose-600 bg-rose-600 text-white" : "border-black/5 bg-white text-neutral-600 hover:bg-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

function ResultNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-3xl bg-white p-4 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
      <p className="text-xs font-black text-neutral-400">{title}</p>
      <p className="mt-1 text-sm font-bold leading-6 text-neutral-800">{body}</p>
    </div>
  );
}
