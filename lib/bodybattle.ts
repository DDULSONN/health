import { getKstWeekId, getKstWeekRange } from "@/lib/weekly";

export type BodyBattleTheme = {
  slug: "shoulders" | "back" | "legs" | "arms" | "upper_chest" | "full_balance" | "growth";
  label: string;
  prompts: string[];
};

export const BODY_BATTLE_THEMES: BodyBattleTheme[] = [
  {
    slug: "shoulders",
    label: "어깨 챔피언전",
    prompts: ["누가 더 어깨 완성도가 높아 보이나요?", "누가 더 상체 프레임이 인상적인가요?"],
  },
  {
    slug: "back",
    label: "등 챔피언전",
    prompts: ["누가 더 등의 넓이와 두께가 좋아 보이나요?"],
  },
  {
    slug: "legs",
    label: "하체 챔피언전",
    prompts: ["누가 더 하체 밸런스와 볼륨이 좋아 보이나요?"],
  },
  {
    slug: "arms",
    label: "팔 챔피언전",
    prompts: ["누가 더 팔 라인과 임팩트가 좋아 보이나요?"],
  },
  {
    slug: "upper_chest",
    label: "가슴 상부 챔피언전",
    prompts: ["누가 더 가슴 상부 라인이 좋아 보이나요?"],
  },
  {
    slug: "full_balance",
    label: "전신 밸런스 챔피언전",
    prompts: ["누가 더 전체적인 운동 완성도와 밸런스가 높아 보이나요?"],
  },
  {
    slug: "growth",
    label: "성장 배틀",
    prompts: ["누가 더 성장 폭이 인상적으로 보이나요?"],
  },
];

export const BODY_BATTLE_MIN_EXPOSURES = 20;
export const BODY_BATTLE_MIN_VOTES = 30;
export const BODY_BATTLE_DEFAULT_RATING = 1000;
export const BODY_BATTLE_ELO_K = 32;
export const BODY_BATTLE_REPORT_BLIND_THRESHOLD = 5;
export const BODY_BATTLE_REPORT_COOLDOWN_MS = 30_000;
export const BODY_BATTLE_REPORT_DAILY_LIMIT = 20;

export function getThemeBySlug(slug: string | null | undefined): BodyBattleTheme | null {
  if (!slug) return null;
  return BODY_BATTLE_THEMES.find((theme) => theme.slug === slug) ?? null;
}

export function getCurrentKstSeasonWindow(now = new Date()) {
  const range = getKstWeekRange(now);
  return {
    weekId: getKstWeekId(now),
    startUtcIso: range.startUtcIso,
    endUtcIso: range.endUtcIso,
  };
}

export function resolvePrompt(themeSlug: string, indexSeed = 0): string {
  const theme = getThemeBySlug(themeSlug);
  if (!theme) return "누가 더 전체적인 운동 완성도가 높아 보이나요?";
  return theme.prompts[indexSeed % theme.prompts.length] ?? theme.prompts[0] ?? "누가 더 전체적인 운동 완성도가 높아 보이나요?";
}

export function buildMatchupKey(aEntryId: string, bEntryId: string): string {
  return [aEntryId, bEntryId].sort((a, b) => a.localeCompare(b)).join(":");
}

export function calcElo(
  ratingA: number,
  ratingB: number,
  scoreA: 1 | 0 | 0.5,
  scoreB: 1 | 0 | 0.5,
  k = BODY_BATTLE_ELO_K
) {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 / (1 + Math.pow(10, (ratingA - ratingB) / 400));
  const newA = ratingA + k * (scoreA - expectedA);
  const newB = ratingB + k * (scoreB - expectedB);
  return {
    expectedA,
    expectedB,
    newA: Math.round(newA * 100) / 100,
    newB: Math.round(newB * 100) / 100,
  };
}

export function clampBodyBattleTop(value: number, fallback = 50) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(value)));
}
