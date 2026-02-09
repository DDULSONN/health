/**
 * 몸평가 (Body Check) - 설문 + 결과 타입
 * 10문항 설문 → 6가지 결과 타입
 */

export interface BodyCheckQuestion {
  id: number;
  text: string;
  options: {
    label: string;
    tags: BodyCheckTypeId[];
  }[];
}

export type BodyCheckTypeId =
  | "bulk_beginner"
  | "cutting"
  | "maintain"
  | "growth"
  | "fat_manage"
  | "broken";

export interface BodyCheckResult {
  id: BodyCheckTypeId;
  title: string;
  emoji: string;
  subtitle: string;
  comment: string;
  tips: string[];
}

export const BODYCHECK_QUESTIONS: BodyCheckQuestion[] = [
  {
    id: 1,
    text: "운동 경력이 얼마나 되나요?",
    options: [
      { label: "6개월 미만", tags: ["bulk_beginner", "broken"] },
      { label: "6개월~2년", tags: ["bulk_beginner", "cutting"] },
      { label: "2년~5년", tags: ["growth", "fat_manage"] },
      { label: "5년 이상", tags: ["growth", "maintain"] },
    ],
  },
  {
    id: 2,
    text: "현재 주요 목표는 무엇인가요?",
    options: [
      { label: "벌크업 / 근비대", tags: ["bulk_beginner", "growth"] },
      { label: "체지방 감량", tags: ["cutting", "fat_manage"] },
      { label: "건강 유지", tags: ["maintain"] },
      { label: "체력 향상", tags: ["growth", "maintain"] },
    ],
  },
  {
    id: 3,
    text: "주간 운동 빈도는?",
    options: [
      { label: "거의 안 함", tags: ["broken"] },
      { label: "주 1~2회", tags: ["broken", "maintain"] },
      { label: "주 3~4회", tags: ["growth", "cutting"] },
      { label: "주 5회 이상", tags: ["growth", "fat_manage"] },
    ],
  },
  {
    id: 4,
    text: "하루 평균 수면 시간은?",
    options: [
      { label: "5시간 이하", tags: ["broken"] },
      { label: "6~7시간", tags: ["cutting", "fat_manage"] },
      { label: "7~8시간", tags: ["growth", "maintain"] },
      { label: "8시간 이상", tags: ["maintain", "bulk_beginner"] },
    ],
  },
  {
    id: 5,
    text: "식단 관리를 하고 있나요?",
    options: [
      { label: "전혀 안 함", tags: ["broken", "bulk_beginner"] },
      { label: "가끔 신경 씀", tags: ["maintain", "bulk_beginner"] },
      { label: "꽤 체계적", tags: ["cutting", "growth"] },
      { label: "매우 철저함", tags: ["fat_manage", "growth"] },
    ],
  },
  {
    id: 6,
    text: "단백질 섭취는 어떻게 하고 있나요?",
    options: [
      { label: "거의 신경 안 씀", tags: ["broken", "bulk_beginner"] },
      { label: "식사로 적당히", tags: ["maintain"] },
      { label: "보충제 포함 관리", tags: ["growth", "cutting"] },
      { label: "체중 × 1.5g 이상 섭취", tags: ["growth", "fat_manage"] },
    ],
  },
  {
    id: 7,
    text: "일상 활동량은 어느 정도인가요?",
    options: [
      { label: "앉아서 주로 생활", tags: ["broken", "fat_manage"] },
      { label: "가끔 걷기/이동", tags: ["maintain", "cutting"] },
      { label: "꽤 활동적", tags: ["growth", "maintain"] },
      { label: "매우 활동적 (육체노동/스포츠)", tags: ["growth"] },
    ],
  },
  {
    id: 8,
    text: "현재 체형에 대한 생각은?",
    options: [
      { label: "체지방이 많다고 느낌", tags: ["cutting", "fat_manage"] },
      { label: "근육이 부족하다고 느낌", tags: ["bulk_beginner", "growth"] },
      { label: "나름 괜찮지만 개선 여지 있음", tags: ["maintain", "growth"] },
      { label: "만족스러움", tags: ["maintain"] },
    ],
  },
  {
    id: 9,
    text: "운동 루틴이 있나요?",
    options: [
      { label: "없음 / 그때그때", tags: ["broken"] },
      { label: "대충 있는 편", tags: ["bulk_beginner", "maintain"] },
      { label: "체계적인 루틴 따르는 중", tags: ["growth", "cutting"] },
      { label: "주기화 / 디로드 포함 계획", tags: ["growth"] },
    ],
  },
  {
    id: 10,
    text: "가장 부족하다고 느끼는 부분은?",
    options: [
      { label: "지속성 / 꾸준함", tags: ["broken", "bulk_beginner"] },
      { label: "식단 관리", tags: ["cutting", "fat_manage"] },
      { label: "수면 / 회복", tags: ["broken", "fat_manage"] },
      { label: "운동 강도 / 볼륨", tags: ["growth", "bulk_beginner"] },
    ],
  },
];

export const BODYCHECK_RESULTS: Record<BodyCheckTypeId, BodyCheckResult> = {
  bulk_beginner: {
    id: "bulk_beginner",
    title: "벌크업 초보",
    emoji: "💪",
    subtitle: "근육을 키우고 싶은 마음은 가득, 경험은 아직 쌓는 중!",
    comment:
      "목표 의식이 확실해서 성장 가능성이 높아요. 기초 복합 운동에 집중하고, 점진적으로 중량을 늘려보세요.",
    tips: [
      "스쿼트/벤치/데드리프트 기초 폼부터 잡기",
      "단백질 섭취량 체중 × 1.2~1.6g 목표",
      "주 3~4회 전신 또는 상하 분할 루틴 추천",
      "수면 7시간 이상 확보하기",
    ],
  },
  cutting: {
    id: "cutting",
    title: "감량 집중형",
    emoji: "🔥",
    subtitle: "체지방을 줄이고 라인을 살리는 게 지금의 미션!",
    comment:
      "감량 의지가 확고하네요. 단, 극단적 식이 제한보다는 적절한 칼로리 적자와 근력 운동을 병행하세요.",
    tips: [
      "유산소보다 근력 운동 우선 (근손실 방지)",
      "일일 300~500kcal 적자 유지",
      "단백질 섭취 유지 (체중 × 1.6g 이상)",
      "주 2~3회 가벼운 유산소 추가",
    ],
  },
  maintain: {
    id: "maintain",
    title: "유지형 헬스러",
    emoji: "⚖️",
    subtitle: "건강하고 균형 잡힌 라이프스타일을 추구해요.",
    comment:
      "안정적인 운동 습관과 생활 패턴을 갖추고 있어요. 꾸준함이 최고의 전략입니다.",
    tips: [
      "현재 루틴에 새로운 자극 추가해보기",
      "유연성/모빌리티 운동 보완",
      "스트레스 관리와 수면 질 유지",
      "정기적인 건강 체크업 받기",
    ],
  },
  growth: {
    id: "growth",
    title: "근성장 집중형",
    emoji: "🏋️",
    subtitle: "이미 기반이 있고, 더 큰 성장을 향해 달리는 중!",
    comment:
      "경험과 지식이 있고, 훈련 강도도 높은 편이에요. 디테일한 프로그래밍과 회복에 신경 쓰면 더 성장할 수 있어요.",
    tips: [
      "주기화 프로그래밍 도입 (볼륨/강도 조절)",
      "디로드 주기 설정 (4~6주마다)",
      "약점 부위 집중 보완 훈련",
      "영양 타이밍 최적화 (운동 전후 탄단)",
    ],
  },
  fat_manage: {
    id: "fat_manage",
    title: "체지방 관리형",
    emoji: "📊",
    subtitle: "체성분을 꼼꼼히 관리하며 최적의 몸을 만들어가는 중!",
    comment:
      "식단과 운동을 체계적으로 관리하고 있어요. 체지방률 유지/감소에 집중하면서 근육량도 챙기세요.",
    tips: [
      "인바디/체성분 측정 월 1회 추적",
      "리컴포지션 전략 활용 (동시 감량+근성장)",
      "식이섬유 및 수분 섭취 충분히",
      "고강도 인터벌 트레이닝(HIIT) 주 1~2회",
    ],
  },
  broken: {
    id: "broken",
    title: "루틴 붕괴형",
    emoji: "🔧",
    subtitle: "운동을 하고 싶은 마음은 있는데, 루틴이 안 잡혀요!",
    comment:
      "시작이 가장 어려운 법이에요. 작은 습관부터 쌓아가면 금방 달라질 수 있어요. 완벽한 루틴보다 '오늘 하나'가 중요합니다.",
    tips: [
      "주 2회 30분부터 시작하기",
      "같은 시간대 운동 습관 만들기",
      "수면 시간 확보 (최소 7시간)",
      "간단한 식단 규칙 하나만 정하기 (예: 매 끼 단백질 포함)",
    ],
  },
};

/** 답변 기반 결과 타입 계산 */
export function calculateBodyCheckResult(
  answers: Record<number, number>
): BodyCheckTypeId {
  const scores: Record<BodyCheckTypeId, number> = {
    bulk_beginner: 0,
    cutting: 0,
    maintain: 0,
    growth: 0,
    fat_manage: 0,
    broken: 0,
  };

  for (const [qIdStr, optionIndex] of Object.entries(answers)) {
    const qId = parseInt(qIdStr, 10);
    const question = BODYCHECK_QUESTIONS.find((q) => q.id === qId);
    if (!question) continue;
    const option = question.options[optionIndex];
    if (!option) continue;
    for (const tag of option.tags) {
      scores[tag]++;
    }
  }

  // 최고 점수 타입 반환
  let maxScore = 0;
  let result: BodyCheckTypeId = "maintain";
  for (const [type, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      result = type as BodyCheckTypeId;
    }
  }

  return result;
}

/** 결과 공유 URL 생성 */
export function buildBodyCheckShareUrl(typeId: BodyCheckTypeId): string {
  return `/bodycheck/result?type=${typeId}`;
}

export const TOTAL_BODYCHECK_QUESTIONS = BODYCHECK_QUESTIONS.length;
