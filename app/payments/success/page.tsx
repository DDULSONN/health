"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type ConfirmResponse = {
  ok?: boolean;
  orderId?: string;
  paymentKey?: string;
  productType?: string;
  readingId?: string | null;
  amount?: number;
  method?: string | null;
  addedCredits?: number;
  creditsAfter?: number;
  alreadyConfirmed?: boolean;
  message?: string;
};

type LoveFortuneReading = {
  id: string;
  status: string;
  calendarType: string;
  birthDate: string;
  birthTime: string;
  birthTimeCertainty: string;
  birthPlace: string | null;
  gender: string;
  loveState: string | null;
  relationshipGoal: string | null;
  meetingPreference: string | null;
  focus: string | null;
  concern: string | null;
  amount: number;
  aiResult: string | null;
  idealFace: {
    title?: string;
    eye?: string;
    smile?: string;
    mood?: string;
    style?: string;
    firstDate?: string;
    avoid?: string;
    note?: string;
  } | null;
  generatedAt: string | null;
  createdAt: string;
};

const LOVE_FORTUNE_LOADING_STEPS = [
  {
    title: "만세력 종이 펼치는 중",
    detail: "양력/음력, 생년월일, 태어난 시간의 기준을 먼저 맞추고 있어요.",
  },
  {
    title: "명식의 중심 잡는 중",
    detail: "일간과 배우자궁을 보고 연애에서 마음이 열리는 방식을 읽고 있어요.",
  },
  {
    title: "오행의 기울기 보는 중",
    detail: "표현, 끌림, 거리감, 불안이 어디서 반복되는지 짚어보고 있어요.",
  },
  {
    title: "대운과 세운 흐름 맞추는 중",
    detail: "지금 시기에 새 인연이 유리한지, 기다림이 필요한지 확인 중이에요.",
  },
  {
    title: "인연 타이밍 정리 중",
    detail: "다가오는 흐름과 조심해야 할 관계 패턴을 현실적인 말로 풀고 있어요.",
  },
  {
    title: "잘 맞는 얼굴상 스케치 중",
    detail: "외모 단정이 아니라 오래 편한 분위기와 인상 결을 정리하고 있어요.",
  },
  {
    title: "상세 풀이 문장 다듬는 중",
    detail: "결과가 나오면 이 화면에 바로 펼쳐지고, 마이페이지에도 저장돼요.",
  },
] as const;

const STEMS = [
  { ko: "갑", hanja: "甲", element: "목", color: "text-emerald-700", bg: "bg-emerald-50" },
  { ko: "을", hanja: "乙", element: "목", color: "text-emerald-700", bg: "bg-emerald-50" },
  { ko: "병", hanja: "丙", element: "화", color: "text-red-600", bg: "bg-red-50" },
  { ko: "정", hanja: "丁", element: "화", color: "text-red-600", bg: "bg-red-50" },
  { ko: "무", hanja: "戊", element: "토", color: "text-amber-700", bg: "bg-amber-50" },
  { ko: "기", hanja: "己", element: "토", color: "text-amber-700", bg: "bg-amber-50" },
  { ko: "경", hanja: "庚", element: "금", color: "text-slate-700", bg: "bg-slate-50" },
  { ko: "신", hanja: "辛", element: "금", color: "text-slate-700", bg: "bg-slate-50" },
  { ko: "임", hanja: "壬", element: "수", color: "text-blue-700", bg: "bg-blue-50" },
  { ko: "계", hanja: "癸", element: "수", color: "text-blue-700", bg: "bg-blue-50" },
];

const BRANCHES = [
  { ko: "자", hanja: "子", animal: "쥐", element: "수" },
  { ko: "축", hanja: "丑", animal: "소", element: "토" },
  { ko: "인", hanja: "寅", animal: "호랑이", element: "목" },
  { ko: "묘", hanja: "卯", animal: "토끼", element: "목" },
  { ko: "진", hanja: "辰", animal: "용", element: "토" },
  { ko: "사", hanja: "巳", animal: "뱀", element: "화" },
  { ko: "오", hanja: "午", animal: "말", element: "화" },
  { ko: "미", hanja: "未", animal: "양", element: "토" },
  { ko: "신", hanja: "申", animal: "원숭이", element: "금" },
  { ko: "유", hanja: "酉", animal: "닭", element: "금" },
  { ko: "술", hanja: "戌", animal: "개", element: "토" },
  { ko: "해", hanja: "亥", animal: "돼지", element: "수" },
];

const ELEMENT_META = {
  목: { label: "목", tone: "시작과 성장", color: "bg-emerald-500", text: "text-emerald-700", soft: "bg-emerald-50" },
  화: { label: "화", tone: "표현과 끌림", color: "bg-red-500", text: "text-red-600", soft: "bg-red-50" },
  토: { label: "토", tone: "안정과 현실감", color: "bg-amber-500", text: "text-amber-700", soft: "bg-amber-50" },
  금: { label: "금", tone: "기준과 선택", color: "bg-slate-500", text: "text-slate-700", soft: "bg-slate-50" },
  수: { label: "수", tone: "감정과 대화", color: "bg-blue-500", text: "text-blue-700", soft: "bg-blue-50" },
} as const;

function formatProductType(productType?: string) {
  if (productType === "apply_credits") return "오픈카드 지원권";
  if (productType === "paid_card") return "대기 없이 등록";
  if (productType === "more_view") return "이상형 더보기";
  if (productType === "city_view") return "가까운 이상형 보기";
  if (productType === "one_on_one_contact_exchange") return "1:1 번호 즉시 교환";
  if (productType === "swipe_premium_30d") return "빠른매칭 플러스";
  if (productType === "love_fortune_detail") return "연애운 상세 풀이";
  return "-";
}

function getPrimaryAction(productType?: string) {
  if (productType === "paid_card") return { href: "/dating/paid", label: "대기 없이 등록으로 돌아가기" };
  if (productType === "one_on_one_contact_exchange") return { href: "/mypage", label: "마이페이지로 돌아가기" };
  if (productType === "swipe_premium_30d") return { href: "/community/dating/cards", label: "빠른매칭으로 돌아가기" };
  if (productType === "city_view") return { href: "/dating/nearby-view", label: "가까운 이상형 보기로 돌아가기" };
  if (productType === "love_fortune_detail") return { href: "/mypage?loveFortune=1#love-fortune", label: "저장된 풀이 보기" };
  return { href: "/dating/more-view", label: "이상형 더보기로 돌아가기" };
}

function parseLoveFortuneReport(text: string | null) {
  if (!text) return [];
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = "상세 풀이";
  let currentLines: string[] = [];

  for (const rawLine of text.replace(/```/g, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*/g, "").split(/\r?\n/)) {
    const heading = rawLine.trim().match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (currentLines.join("\n").trim()) {
        sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
      }
      currentTitle = heading[1]?.trim() || "상세 풀이";
      currentLines = [];
      continue;
    }
    currentLines.push(rawLine);
  }

  if (currentLines.join("\n").trim()) {
    sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
  }

  return sections.length > 0 ? sections : [{ title: "상세 풀이", body: text.trim() }];
}

function seedFromReading(reading: LoveFortuneReading | null) {
  const raw = reading
    ? [reading.birthDate, reading.birthTime, reading.loveState, reading.relationshipGoal, reading.meetingPreference, reading.focus, reading.concern].join("|")
    : "love-fortune";
  return raw.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildFortuneSummary(reading: LoveFortuneReading | null) {
  const seed = seedFromReading(reading);
  const stem = STEMS[seed % STEMS.length];
  const branch = BRANCHES[(seed + 5) % BRANCHES.length];
  const monthStem = STEMS[(seed + 3) % STEMS.length];
  const monthBranch = BRANCHES[(seed + 8) % BRANCHES.length];
  const yearStem = STEMS[(seed + 6) % STEMS.length];
  const yearBranch = BRANCHES[(seed + 1) % BRANCHES.length];
  const hourStem = STEMS[(seed + 9) % STEMS.length];
  const hourBranch = BRANCHES[(seed + 10) % BRANCHES.length];
  const relationTypes = [
    "천천히 가까워질수록 강해지는 관계형",
    "대화 온도가 맞을 때 빠르게 깊어지는 관계형",
    "편안함 속에서 설렘이 오래 남는 관계형",
    "기준이 분명해야 안정되는 선택형",
  ];
  const flowNotes = [
    "무리하게 확신을 요구하기보다, 첫 만남의 편안함을 기준으로 보면 좋아요.",
    "호감이 생겼을 때 답장 속도보다 약속의 안정성을 먼저 보는 편이 좋아요.",
    "초반에는 가벼운 대화로 문을 열고, 두 번째 만남에서 깊은 이야기를 꺼내는 흐름이 맞아요.",
    "너무 강한 어필보다 생활 루틴과 가치관을 보여줄 때 매력이 오래 갑니다.",
  ];
  const timingTone = [
    "새 인연을 만나기 좋은 흐름",
    "관계가 깊어지기 쉬운 흐름",
    "기존 감정을 정리하고 선택하기 좋은 흐름",
    "소개팅과 대화 운이 살아나는 흐름",
  ];
  const timingSeason = [
    "봄에서 초여름 사이",
    "여름이 지나 가을로 넘어가는 시기",
    "연말 전후",
    "새해 초반",
  ];
  const loveScore = 70 + (seed % 21);
  const scores = [
    { label: "연애 표현력", value: 78 + (seed % 17) },
    { label: "관계 안정감", value: 74 + ((seed + 7) % 19) },
    { label: "호감 지속력", value: 76 + ((seed + 11) % 18) },
    { label: "소개팅 행동력", value: 72 + ((seed + 13) % 21) },
  ];
  const pillars = [
    { label: "년주", stem: yearStem, branch: yearBranch },
    { label: "월주", stem: monthStem, branch: monthBranch },
    { label: "일주", stem, branch },
    { label: "시주", stem: hourStem, branch: hourBranch },
  ];
  const counts = pillars.reduce<Record<keyof typeof ELEMENT_META, number>>(
    (acc, pillar) => {
      acc[pillar.stem.element as keyof typeof ELEMENT_META] += 1;
      acc[pillar.branch.element as keyof typeof ELEMENT_META] += 1;
      return acc;
    },
    { 목: 0, 화: 0, 토: 0, 금: 0, 수: 0 }
  );
  const maxCount = Math.max(1, ...Object.values(counts));
  const elementRows = (Object.keys(ELEMENT_META) as Array<keyof typeof ELEMENT_META>).map((key) => ({
    key,
    count: counts[key],
    width: Math.max(8, Math.round((counts[key] / maxCount) * 100)),
    ...ELEMENT_META[key],
  }));
  const relationType = relationTypes[seed % relationTypes.length];
  const flowNote = flowNotes[(seed + 2) % flowNotes.length];
  const timingCards = [
    {
      title: "최고의 인연 시기",
      period: timingSeason[seed % timingSeason.length],
      body: timingTone[(seed + 1) % timingTone.length],
    },
    {
      title: "연애운이 강한 시기",
      period: timingSeason[(seed + 2) % timingSeason.length],
      body: "먼저 다가가기보다 대화를 이어가며 확신을 쌓을 때 좋은 결과가 납니다.",
    },
    {
      title: "조심할 시기",
      period: timingSeason[(seed + 3) % timingSeason.length],
      body: "감정이 앞서면 판단이 흐려질 수 있어, 약속과 태도를 천천히 확인하는 편이 좋아요.",
    },
  ];

  return { stem, branch, pillars, scores, elementRows, relationType, flowNote, loveScore, timingCards };
}

function buildIdealFaceSketchDataUrl(reading: LoveFortuneReading, target: "male" | "female") {
  const seed = seedFromReading(reading) + (target === "male" ? 17 : 41);
  const ideal = reading.idealFace ?? {};
  const accent = target === "male" ? "#6b4a2f" : "#c04f7a";
  const accentLight = target === "male" ? "#efe1cf" : "#fde7ef";
  const hair = target === "male" ? "#34261f" : "#2d2420";
  const blush = target === "male" ? "#e9ad96" : "#f1a5b7";
  const eyeY = 108 + (seed % 5);
  const smileCurve = 146 + (seed % 4);
  const hairPath =
    target === "male"
      ? "M66 88 C70 44 130 35 169 67 C184 79 190 102 186 128 C170 102 145 85 110 86 C91 86 78 91 66 88Z"
      : "M55 111 C50 63 88 34 126 38 C169 39 195 72 195 124 C192 159 181 182 169 198 C172 144 157 91 124 88 C92 91 74 130 78 198 C64 180 56 153 55 111Z";
  const hairLine =
    target === "male"
      ? "M82 84 C100 62 130 58 163 79 M78 91 C103 83 132 83 180 122"
      : "M78 88 C97 63 138 61 168 91 M76 116 C95 100 151 101 174 119";
  const label = target === "male" ? "남자 얼굴상" : "여자 얼굴상";
  const subtitle = target === "male" ? "담백한 안정감" : "부드러운 온도감";
  const encoded = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 320">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#fffaf0"/>
          <stop offset="1" stop-color="${accentLight}"/>
        </linearGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#6b3f24" flood-opacity=".16"/>
        </filter>
      </defs>
      <rect width="260" height="320" rx="34" fill="url(#bg)"/>
      <circle cx="130" cy="124" r="82" fill="#fff7e8" stroke="${accent}" stroke-width="3" filter="url(#soft)"/>
      <path d="${hairPath}" fill="${hair}" opacity=".96"/>
      <path d="${hairLine}" fill="none" stroke="#fff0d5" stroke-width="4" stroke-linecap="round" opacity=".55"/>
      <path d="M76 204 C95 231 164 232 184 204 C178 264 82 264 76 204Z" fill="#fff7e8" stroke="${accent}" stroke-width="3"/>
      <path d="M71 224 C101 210 159 210 190 224 C205 236 210 262 210 286 L50 286 C50 262 56 236 71 224Z" fill="${accentLight}" stroke="${accent}" stroke-width="3"/>
      <ellipse cx="98" cy="${eyeY}" rx="9" ry="12" fill="#2b2118"/>
      <ellipse cx="162" cy="${eyeY}" rx="9" ry="12" fill="#2b2118"/>
      <circle cx="101" cy="${eyeY - 4}" r="3" fill="#fff"/>
      <circle cx="165" cy="${eyeY - 4}" r="3" fill="#fff"/>
      <path d="M119 128 C126 132 134 132 141 128" fill="none" stroke="#a9795b" stroke-width="3" stroke-linecap="round"/>
      <path d="M104 ${smileCurve} C121 ${smileCurve + 12} 143 ${smileCurve + 12} 158 ${smileCurve}" fill="none" stroke="#6b3f24" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="79" cy="140" rx="14" ry="8" fill="${blush}" opacity=".55"/>
      <ellipse cx="181" cy="140" rx="14" ry="8" fill="${blush}" opacity=".55"/>
      <path d="M67 119 C83 106 94 101 105 102" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
      <path d="M193 119 C177 106 166 101 155 102" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity=".55"/>
      <text x="130" y="44" text-anchor="middle" font-size="13" font-weight="800" fill="${accent}" font-family="Arial, sans-serif">${label}</text>
      <text x="130" y="303" text-anchor="middle" font-size="13" font-weight="800" fill="#6b4a2f" font-family="Arial, sans-serif">${subtitle}</text>
    </svg>
  `);

  return {
    src: `data:image/svg+xml;charset=utf-8,${encoded}`,
    label,
    body:
      target === "male"
        ? `${String(ideal.eye ?? "편안한 눈매")}와 ${String(ideal.style ?? "깔끔한 스타일")} 쪽의 남성 인상`
        : `${String(ideal.smile ?? "따뜻한 미소")}와 ${String(ideal.mood ?? "편안한 분위기")} 쪽의 여성 인상`,
  };
}

function LoveFortuneResultPanel({ reading }: { reading: LoveFortuneReading }) {
  const sections = useMemo(() => parseLoveFortuneReport(reading.aiResult), [reading.aiResult]);
  const summary = useMemo(() => buildFortuneSummary(reading), [reading]);
  const ideal = reading.idealFace ?? {};
  const idealTarget = reading.gender === "female" ? "male" : reading.gender === "male" ? "female" : null;
  const idealSketches = useMemo(
    () => (idealTarget ? [buildIdealFaceSketchDataUrl(reading, idealTarget)] : [buildIdealFaceSketchDataUrl(reading, "male"), buildIdealFaceSketchDataUrl(reading, "female")]),
    [idealTarget, reading]
  );
  const firstSection = sections[0];
  const detailSections = sections.slice(1);

  return (
    <section className="mx-auto mt-6 max-w-[760px] overflow-hidden rounded-[34px] border border-[#d8c5a5] bg-[#f7efe2] text-[#2b2118] shadow-[0_24px_80px_rgba(55,33,12,0.16)]">
      <div className="border-b border-[#d8c5a5] bg-[radial-gradient(circle_at_18%_0%,rgba(180,108,43,0.18),transparent_32%),linear-gradient(135deg,#fff9ee,#efe0c8)] p-6 text-center sm:p-8">
        <p className="text-xs font-black tracking-[0.28em] text-[#9a5a23]">命式 · 사랑과 관계</p>
        <h2 className="mt-4 text-3xl font-black tracking-tight text-[#24170f] sm:text-5xl">도화냥 연애 명식</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-stone-600">
          결제 확인 후 바로 생성된 상세 풀이입니다. 한눈에 보는 명식 요약과 아래의 상세 상담 풀이를 함께 확인해 주세요.
        </p>
      </div>

      <div className="space-y-5 p-5 sm:p-7">
        <div className="rounded-[30px] border border-rose-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-black tracking-[0.18em] text-[#b13b2e]">배우자 얼굴상</p>
              <h3 className="mt-2 text-2xl font-black text-stone-950">나와 오래 맞기 쉬운 인상</h3>
            </div>
            <span className="rounded-full bg-rose-50 px-3 py-1 text-[11px] font-black text-rose-700">사주 기반 스케치</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-stone-500">
            실제 외모를 단정하지 않고, 입력한 연애 성향과 명식 흐름에서 오래 편하게 맞기 쉬운 분위기를 스케치로 정리했어요.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr]">
            {idealSketches.map((sketch) => (
              <div key={sketch.label} className="overflow-hidden rounded-[26px] border border-rose-100 bg-rose-50/50 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sketch.src}
                  alt={`${sketch.label} 스케치`}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full rounded-[20px] bg-white object-contain"
                />
                <p className="mt-3 text-sm font-black text-stone-950">{sketch.label}</p>
                <p className="mt-1 text-xs leading-5 text-stone-600">{sketch.body}</p>
              </div>
            ))}
            <div className="grid content-start gap-2 text-sm leading-6 text-stone-700">
              <p className="rounded-2xl bg-rose-50 p-3">눈매 · {String(ideal.eye ?? "편안하게 오래 마주볼 수 있는 눈매")}</p>
              <p className="rounded-2xl bg-rose-50 p-3">미소 · {String(ideal.smile ?? "담백하지만 따뜻한 미소")}</p>
              <p className="rounded-2xl bg-rose-50 p-3">분위기 · {String(ideal.mood ?? "급하지 않고 신뢰가 쌓이는 분위기")}</p>
              <p className="rounded-2xl bg-rose-50 p-3">첫 만남 · {String(ideal.firstDate ?? "대화가 편한 사람")}</p>
              <p className="rounded-2xl bg-amber-50 p-3 text-amber-900">피하면 좋은 흐름 · {String(ideal.avoid ?? "처음부터 확답을 강요하는 분위기")}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-[#d8c5a5] bg-white/80 p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-sm font-black text-stone-900">사주 원국</p>
                <p className="mt-1 text-xs leading-5 text-stone-500">입력 정보 기반으로 정리한 상담용 명식입니다.</p>
              </div>
              <span className="rounded-full bg-[#2b2118] px-3 py-1 text-[11px] font-black text-[#f6d9a8]">연애 특화</span>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border-2 border-[#2b2118] bg-white text-center">
              <div className="grid grid-cols-4 border-b-2 border-[#2b2118] bg-[#f4ead8]">
                {summary.pillars.map((pillar) => (
                  <p key={pillar.label} className="border-r border-[#d8c5a5] py-2 text-xs font-black text-stone-600 last:border-r-0">
                    {pillar.label}
                  </p>
                ))}
              </div>
              <div className="grid grid-cols-4">
                {summary.pillars.map((pillar) => (
                  <div key={`${pillar.label}-stem`} className={`${pillar.stem.bg} border-r border-[#d8c5a5] px-2 py-4 last:border-r-0`}>
                    <p className={`text-4xl font-black ${pillar.stem.color}`}>{pillar.stem.ko}</p>
                    <p className="mt-1 text-sm font-bold text-stone-500">{pillar.stem.hanja} · {pillar.stem.element}</p>
                    <p className="mt-1 text-[11px] font-semibold text-stone-400">천간</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-4 border-t border-[#d8c5a5]">
                {summary.pillars.map((pillar) => (
                  <div key={`${pillar.label}-branch`} className="border-r border-[#d8c5a5] px-2 py-4 last:border-r-0">
                    <p className="text-3xl font-black text-stone-800">{pillar.branch.ko}</p>
                    <p className="mt-1 text-sm font-bold text-stone-500">{pillar.branch.hanja} · {pillar.branch.animal}</p>
                    <p className="mt-1 text-[11px] font-semibold text-stone-400">지지 · {pillar.branch.element}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-[#d8c5a5] bg-white/80 p-4">
            <p className="text-sm font-black text-stone-900">오행 분포</p>
            <p className="mt-1 text-xs leading-5 text-stone-500">연애에서 드러나는 표현, 안정감, 선택 기준의 균형을 봅니다.</p>
            <div className="mt-4 space-y-3">
              {summary.elementRows.map((item) => (
                <div key={item.key} className="grid grid-cols-[42px_1fr_32px] items-center gap-3">
                  <p className={`text-sm font-black ${item.text}`}>{item.label}</p>
                  <div className="h-3 overflow-hidden rounded-full bg-stone-100">
                    <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.width}%` }} />
                  </div>
                  <p className="text-right text-xs font-black text-stone-500">{item.count}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {summary.scores.map((score) => (
              <div key={score.label} className="rounded-2xl border border-[#d8c5a5] bg-[#fdf8ee] p-4">
                <p className="text-xs font-bold text-stone-500">{score.label}</p>
                <p className="mt-2 text-3xl font-black text-[#b13b2e]">{score.value}</p>
                <p className="mt-1 text-[11px] font-semibold text-stone-400">상담용 지표</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-3xl border border-[#d8c5a5] bg-white p-5">
              <p className="text-xs font-black tracking-[0.18em] text-[#9a5a23]">현재 연애운</p>
              <div className="mt-3 flex items-end gap-2">
                <p className="text-6xl font-black text-[#e43f72]">{summary.loveScore}</p>
                <p className="pb-2 text-2xl font-black text-[#e43f72]">%</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-stone-600">
                사주 흐름상 관계를 새로 열거나, 이미 있는 감정을 더 분명히 보기 좋은 구간입니다.
              </p>
            </div>
            <div className="rounded-3xl border border-[#d8c5a5] bg-white p-5">
              <p className="text-xs font-black tracking-[0.18em] text-[#9a5a23]">사랑 타이밍</p>
              <div className="mt-3 space-y-2">
                {summary.timingCards.map((item) => (
                  <div key={item.title} className="rounded-2xl bg-[#fff4f7] p-3">
                    <p className="text-sm font-black text-stone-950">{item.title}</p>
                    <p className="mt-1 text-sm font-bold text-[#e43f72]">{item.period}</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-[#d8c5a5] bg-[#2b2118] p-5 text-white">
            <p className="text-xs font-black tracking-[0.18em] text-[#f6d9a8]">핵심 판정</p>
            <h3 className="mt-3 text-2xl font-black leading-9">{summary.relationType}</h3>
            <p className="mt-3 text-sm leading-7 text-white/75">{summary.flowNote}</p>
          </div>

          <div className="rounded-3xl border border-[#d8c5a5] bg-white p-5">
            <p className="text-xs font-black tracking-[0.18em] text-[#9a5a23]">총평</p>
            <div className="mt-2 whitespace-pre-wrap text-lg font-bold leading-8 text-stone-950">{firstSection?.body || "상세 풀이가 생성되었습니다."}</div>
          </div>

          <div className="rounded-3xl border border-[#d8c5a5] bg-white p-5">
            <p className="text-sm font-black text-stone-900">상세 풀이 구성</p>
            <div className="mt-3 grid gap-2">
              {detailSections.slice(0, 5).map((section, index) => (
                <div key={`${section.title}-toc`} className="flex items-center gap-3 rounded-2xl bg-[#f7efe2] px-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2b2118] text-xs font-black text-[#f6d9a8]">{index + 1}</span>
                  <p className="text-sm font-bold text-stone-800">{section.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[#d8c5a5] bg-[#efe2cf] px-5 py-8 text-center sm:px-7">
        <p className="text-xs font-black tracking-[0.26em] text-[#9a5a23]">DETAILED READING</p>
        <h3 className="mt-2 text-2xl font-black text-[#2b2118]">아래부터는 상세 연애 풀이입니다</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">
          사주 용어는 일상어로 풀고, 실제 소개팅과 관계 선택에 연결되도록 정리했어요.
        </p>
      </div>

      <div className="space-y-5 px-5 pb-8 sm:px-7">
        {detailSections.map((section, index) => (
          <article key={`${section.title}-${index}`} className="rounded-[28px] border border-[#d8c5a5] bg-[#fffaf2] p-5 shadow-sm">
            <div className="flex items-center gap-3 border-b border-[#ead9bf] pb-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2b2118] text-sm font-black text-[#f6d9a8]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h4 className="text-lg font-black text-stone-950">{section.title}</h4>
            </div>
            <div className="mt-4 whitespace-pre-wrap text-[15px] leading-8 text-stone-700">{section.body}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [fortuneLoading, setFortuneLoading] = useState(false);
  const [fortuneLoadingStep, setFortuneLoadingStep] = useState(0);
  const [fortuneGenerateAttempted, setFortuneGenerateAttempted] = useState(false);
  const [fortuneError, setFortuneError] = useState("");
  const [fortuneReading, setFortuneReading] = useState<LoveFortuneReading | null>(null);

  useEffect(() => {
    const paymentKey = searchParams.get("paymentKey") ?? "";
    const orderId = searchParams.get("orderId") ?? "";
    const amount = searchParams.get("amount") ?? "";

    if (!paymentKey || !orderId || !amount) {
      setError("결제 확인 정보가 올바르지 않습니다.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/payments/toss/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentKey, orderId, amount }),
        });
        const body = (await res.json().catch(() => ({}))) as ConfirmResponse;
        if (!res.ok || !body.ok) {
          if (!cancelled) setError(body.message ?? "결제 확인 처리에 실패했습니다.");
          return;
        }
        if (!cancelled) setResult(body);
      } catch {
        if (!cancelled) setError("결제 확인 중 서버 오류가 발생했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    if (result?.productType !== "love_fortune_detail" || !result.readingId || fortuneReading || fortuneGenerateAttempted) return;

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 55000);
    setFortuneGenerateAttempted(true);
    setFortuneLoadingStep(0);
    setFortuneLoading(true);
    setFortuneError("");
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/mypage/love-fortune", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ readingId: result.readingId }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; reading?: LoveFortuneReading };
        if (!res.ok || !body.ok || !body.reading) {
          throw new Error(body.message ?? "연애운 상세 풀이를 생성하지 못했습니다.");
        }
        if (!cancelled) setFortuneReading(body.reading);
      } catch (err) {
        if (!cancelled) {
          const isAbort = err instanceof DOMException && err.name === "AbortError";
          setFortuneError(isAbort ? "상세 풀이 생성이 오래 걸리고 있어요. 결제는 저장됐으니 마이페이지에서 다시 열 수 있습니다." : err instanceof Error ? err.message : "연애운 상세 풀이를 생성하지 못했습니다.");
        }
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setFortuneLoading(false);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [fortuneGenerateAttempted, fortuneReading, result]);

  useEffect(() => {
    if (!fortuneLoading) return;

    const timer = window.setInterval(() => {
      setFortuneLoadingStep((current) => Math.min(current + 1, LOVE_FORTUNE_LOADING_STEPS.length - 1));
    }, 1200);

    return () => window.clearInterval(timer);
  }, [fortuneLoading]);

  const primaryAction = getPrimaryAction(result?.productType);
  const isLoveFortune = result?.productType === "love_fortune_detail";
  const activeFortuneLoadingStep = LOVE_FORTUNE_LOADING_STEPS[fortuneLoadingStep] ?? LOVE_FORTUNE_LOADING_STEPS[0];
  const fortuneLoadingProgress = Math.min(
    92,
    Math.round(((fortuneLoadingStep + 1) / LOVE_FORTUNE_LOADING_STEPS.length) * 92),
  );

  return (
    <main className={`mx-auto px-4 py-8 ${isLoveFortune ? "max-w-5xl" : "max-w-2xl"}`}>
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">결제가 완료됐어요</h1>

        {loading ? <p className="mt-4 text-sm text-neutral-500">결제 상태를 확인하고 있어요.</p> : null}
        {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

        {!loading && !error && result ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">
                {result.alreadyConfirmed ? "이미 처리된 결제예요." : "결제가 정상적으로 확인됐어요."}
              </p>
              <p className="mt-1 text-sm text-emerald-900">주문번호: {result.orderId ?? "-"}</p>
              {isLoveFortune ? (
                <p className="mt-1 text-sm font-semibold text-emerald-900">잠시만 기다리면 이 화면에서 바로 상세 풀이가 열립니다.</p>
              ) : (
                <p className="mt-1 text-sm text-emerald-900">결제 키: {result.paymentKey ?? "-"}</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">상품</p>
                <p className="mt-1 font-semibold text-neutral-900">{formatProductType(result.productType)}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">결제 금액</p>
                <p className="mt-1 font-semibold text-neutral-900">
                  {typeof result.amount === "number" ? `${result.amount.toLocaleString("ko-KR")}원` : "-"}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">결제 수단</p>
                <p className="mt-1 font-semibold text-neutral-900">{result.method ?? "-"}</p>
              </div>
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                <p className="text-xs font-medium text-neutral-500">적용 결과</p>
                <p className="mt-1 font-semibold text-neutral-900">
                  {typeof result.addedCredits === "number" && result.addedCredits > 0
                    ? `지원권 +${result.addedCredits}장 / 현재 ${result.creditsAfter ?? 0}장`
                    : result.productType === "paid_card"
                      ? "대기 없이 등록 결제가 반영됐어요"
                      : result.productType === "one_on_one_contact_exchange"
                        ? "상대 연락처 즉시 공개"
                        : result.productType === "swipe_premium_30d"
                          ? "빠른매칭 플러스 적용 완료"
                          : result.productType === "city_view"
                            ? "가까운 이상형 보기 권한 반영 완료"
                            : result.productType === "love_fortune_detail"
                              ? "연애운 상세 풀이 생성 준비 완료"
                              : "결제 반영 완료"}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {isLoveFortune && fortuneLoading ? (
          <div className="mt-6 overflow-hidden rounded-3xl border border-amber-200 bg-[radial-gradient(circle_at_16%_0%,rgba(245,158,11,0.22),transparent_34%),linear-gradient(135deg,#fff7ed,#fef3c7)] p-5 shadow-[0_18px_45px_rgba(146,64,14,0.12)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-amber-950">도화냥이 만세력 종이를 펴고 있어요.</p>
                <p className="mt-1 text-xs font-bold text-amber-700">
                  {fortuneLoadingStep + 1}/{LOVE_FORTUNE_LOADING_STEPS.length} 단계 분석 중
                </p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-full bg-white/75 px-3 py-1.5 text-xs font-black text-amber-900">
                분석 중
                <span className="ml-1 h-1.5 w-1.5 animate-bounce rounded-full bg-amber-700 [animation-delay:-0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-500 [animation-delay:-0.1s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-700" />
              </div>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-amber-100/80">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-800 via-rose-500 to-amber-700 shadow-[0_0_18px_rgba(244,63,94,0.45)] transition-all duration-700 ease-out"
                style={{ width: `${fortuneLoadingProgress}%` }}
              />
            </div>

            <div className="mt-4 rounded-3xl border border-white/70 bg-white/75 p-4">
              <p className="text-base font-black text-amber-950">{activeFortuneLoadingStep.title}</p>
              <p className="mt-2 text-sm leading-6 text-amber-800">{activeFortuneLoadingStep.detail}</p>
            </div>

            <div className="mt-4 grid gap-2 text-xs font-bold text-amber-900 sm:grid-cols-2">
              {LOVE_FORTUNE_LOADING_STEPS.map((step, index) => {
                const isDone = index < fortuneLoadingStep;
                const isActive = index === fortuneLoadingStep;
                return (
                  <p
                    key={step.title}
                    className={`flex items-center gap-2 rounded-2xl px-3 py-2 transition-all duration-300 ${
                      isActive
                        ? "bg-amber-950 text-white shadow-sm"
                        : isDone
                          ? "bg-white/80 text-amber-950"
                          : "bg-white/45 text-amber-700/70"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        isActive
                          ? "bg-white text-amber-950"
                          : isDone
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-500"
                      }`}
                    >
                      {isDone ? "✓" : index + 1}
                    </span>
                    {step.title}
                  </p>
                );
              })}
            </div>
            <p className="mt-3 text-sm leading-6 text-amber-800">결과가 나오면 이 화면에 바로 펼쳐집니다. 창을 닫아도 마이페이지에 저장돼요.</p>
          </div>
        ) : null}

        {isLoveFortune && fortuneError ? (
          <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm font-bold text-red-800">{fortuneError}</p>
            <p className="mt-2 text-sm text-red-700">결제는 반영됐으니 마이페이지에서 다시 생성할 수 있어요.</p>
          </div>
        ) : null}

        {!isLoveFortune ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={primaryAction.href}
              className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              {primaryAction.label}
            </Link>
            <Link
              href="/mypage"
              className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              마이페이지
            </Link>
          </div>
        ) : null}
      </section>

      {fortuneReading ? <LoveFortuneResultPanel reading={fortuneReading} /> : null}

      {isLoveFortune ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={primaryAction.href}
            className="inline-flex min-h-[44px] items-center rounded-xl bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800"
          >
            {primaryAction.label}
          </Link>
          <Link
            href="/community/dating/cards"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            연애운으로 돌아가기
          </Link>
        </div>
      ) : null}
    </main>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-4 py-8">
          <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold text-neutral-900">결제가 완료됐어요</h1>
            <p className="mt-4 text-sm text-neutral-500">결제 상태를 확인하고 있어요.</p>
          </section>
        </main>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}
