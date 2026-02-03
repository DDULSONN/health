/**
 * 결과 10종 콘텐츠 (title, subtitle, traits, shareText, emoji)
 * 톤: 비하/혐오 금지, 가볍고 웃기되 기분 나쁘지 않게
 */

import type { ResultId } from "./types";

export interface ResultContent {
  id: ResultId;
  title: string;
  subtitle: string;
  traits: string[];
  shareText: string;
  emoji: string;
}

export const RESULTS: Record<ResultId, ResultContent> = {
  heavy_ss: {
    id: "heavy_ss",
    title: "중증 헬창 (SS급)",
    subtitle: "헬스가 일상의 중심, 이미 라이프스타일",
    traits: [
      "헬스 일정이 곧 일정",
      "쉬겠다고 생각해도 결국 헬스장",
      "여행·출장에도 헬스장 체크",
      "‘그렇게까지 해야 해?’에 살짝 발끈",
      "운동이 삶의 기준선",
    ],
    shareText: "헬창 판독기 결과: 나는 중증 헬창 (SS급)이야 💪",
    emoji: "🏆",
  },
  senior: {
    id: "senior",
    title: "상급 헬창 (S급)",
    subtitle: "꾸준함과 열정이 묻어나는 레벨",
    traits: [
      "헬스가 습관이자 낙",
      "쉬는 날도 은근히 생각남",
      "출장·여행 시 헬스장 검색",
      "운동 얘기 나오면 반응 크다",
      "적당히 미친 척",
    ],
    shareText: "헬창 판독기 결과: 나는 상급 헬창 (S급)이야 💪",
    emoji: "🔥",
  },
  routine: {
    id: "routine",
    title: "루틴 집착러",
    subtitle: "정해진 흐름이 있어야 마음이 편해요",
    traits: [
      "헬스 일정에 맞춰 하루 설계",
      "루틴은 있다고 말하지만 자주 업데이트",
      "술·야식 제안 시 내일 운동이 먼저 떠오름",
      "순서나 요일이 바뀌면 은근히 스트레스",
      "계획형 헬스러",
    ],
    shareText: "헬창 판독기 결과: 나는 루틴 집착러야 📋",
    emoji: "📋",
  },
  talk: {
    id: "talk",
    title: "스몰톡 헬창",
    subtitle: "운동 얘기만 나오면 말이 길어져요",
    traits: [
      "새 사람 만나면 운동 여부 은근히 체크",
      "일상 대화에 운동이 자동 등장",
      "‘오늘 뭐 했어?’에 설명이 길어짐",
      "운동 얘기할 때 눈빛이 달라짐",
      "친해지면 루틴 공유",
    ],
    shareText: "헬창 판독기 결과: 나는 스몰톡 헬창이야 🗣️",
    emoji: "🗣️",
  },
  pump: {
    id: "pump",
    title: "펌프 중독자",
    subtitle: "거울과 자세, 오늘 컨디션의 기준",
    traits: [
      "체중보다 거울이 오늘 컨디션 지표",
      "운동 끝나면 거울에서 자세 한 번 더",
      "상의 핏에서 어깨·등 라인이 더 중요",
      "펌핑 후 기분이 좋아짐",
      "시각적 피드백에 민감",
    ],
    shareText: "헬창 판독기 결과: 나는 펌프 중독자야 🪞",
    emoji: "🪞",
  },
  frame: {
    id: "frame",
    title: "근육 태토남 (프레임형)",
    subtitle: "어깨·등 라인, 핏에 대한 감각이 있어요",
    traits: [
      "상의 핏에서 가슴보다 어깨·등이 먼저",
      "프레임·비율에 관심",
      "헬린이 감성은 거의 없음",
      "꾸준히 오래한 스타일",
      "옷 입을 때 라인이 보임",
    ],
    shareText: "헬창 판독기 결과: 나는 근육 태토남 (프레임형)이야 👔",
    emoji: "👔",
  },
  egennam: {
    id: "egennam",
    title: "근육 에겐남",
    subtitle: "운동 얘기만 나오면 설명이 풍부해져요",
    traits: [
      "일상 대화에 운동이 자동 등장",
      "‘오늘 뭐 했어?’에 대답이 길어짐",
      "중증 헬창급은 아니어도 열정 있음",
      "친해지면 루틴·부위 얘기 자연스럽게",
      "에겐남 감성",
    ],
    shareText: "헬창 판독기 결과: 나는 근육 에겐남이야 💬",
    emoji: "💬",
  },
  newbie: {
    id: "newbie",
    title: "귀여운 헬린이",
    subtitle: "아직 제대로 한 지는 얼마 안 됐어요",
    traits: [
      "루틴은 있다고 말하지만 자주 바뀜",
      "‘제대로 한 지는 얼마 안 됐어요’ 말해봤음",
      "총점은 중간대, 성장 여지 많음",
      "꾸준히 가면 레벨업 예상",
      "시작이 반",
    ],
    shareText: "헬창 판독기 결과: 나는 귀여운 헬린이야 🌱",
    emoji: "🌱",
  },
  manage: {
    id: "manage",
    title: "관리형 헬스러",
    subtitle: "운동과 식단·일상을 같이 챙기는 타입",
    traits: [
      "메뉴 고를 때 단백질·구성이 보임",
      "배달도 ‘운동한 날 먹어도 되지’ 기준",
      "술·야식 제안 시 내일 운동이 떠오름",
      "총점은 중간대, 밸런스 중시",
      "꾸준함과 절제",
    ],
    shareText: "헬창 판독기 결과: 나는 관리형 헬스러야 🥗",
    emoji: "🥗",
  },
  reality: {
    id: "reality",
    title: "건강 현실파",
    subtitle: "운동은 하고 싶되, 현실과의 균형을 중요시",
    traits: [
      "운동을 과하지 않게 즐기는 편",
      "일정·컨디션에 맞춰 유연하게",
      "‘그렇게까지’보다는 꾸준함",
      "건강한 라이프스타일 지향",
      "현실적인 헬스러",
    ],
    shareText: "헬창 판독기 결과: 나는 건강 현실파야 ☀️",
    emoji: "☀️",
  },
};
