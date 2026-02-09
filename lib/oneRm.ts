/**
 * 1RM 추정 계산 로직
 * - Epley, Brzycki 공식
 * - 단위 변환 (kg ↔ lb)
 * - 퍼센트 표 계산
 */

export type Formula = "epley" | "brzycki";
export type WeightUnit = "kg" | "lb";
export type LiftType = "squat" | "bench" | "deadlift" | "other";

const KG_TO_LB = 2.20462;
const LB_TO_KG = 1 / KG_TO_LB;

/** kg → lb */
export function kgToLb(kg: number): number {
  return kg * KG_TO_LB;
}

/** lb → kg */
export function lbToKg(lb: number): number {
  return lb * LB_TO_KG;
}

/** Epley 공식: 1RM = w × (1 + reps/30) */
export function epley(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

/** Brzycki 공식: 1RM = w × 36 / (37 - reps) */
export function brzycki(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  if (reps >= 37) return 0; // 공식 한계
  return weight * (36 / (37 - reps));
}

/** 1RM 계산 (공식 선택) */
export function calculate1RM(
  weight: number,
  reps: number,
  formula: Formula
): number {
  if (weight <= 0 || reps <= 0) return 0;
  const fn = formula === "epley" ? epley : brzycki;
  return fn(weight, reps);
}

/** 퍼센트 표에 사용할 비율 목록 */
export const PERCENTAGE_LIST = [95, 90, 85, 80, 75, 70, 60, 50] as const;

export interface PercentageRow {
  percent: number;
  kg: number;
  lb: number;
}

/** 1RM 기반 퍼센트 표 생성 */
export function getPercentageTable(oneRmKg: number): PercentageRow[] {
  return PERCENTAGE_LIST.map((percent) => {
    const kg = oneRmKg * (percent / 100);
    return {
      percent,
      kg: Math.round(kg * 10) / 10,
      lb: Math.round(kgToLb(kg) * 10) / 10,
    };
  });
}

/** 운동 종류 한글 라벨 */
export const LIFT_LABELS: Record<LiftType, string> = {
  squat: "스쿼트",
  bench: "벤치프레스",
  deadlift: "데드리프트",
  other: "기타",
};

/** URL 쿼리 파라미터 생성 */
export function build1RMShareUrl(params: {
  weight: number;
  reps: number;
  unit: WeightUnit;
  formula: Formula;
  lift: LiftType;
}): string {
  const sp = new URLSearchParams({
    w: String(params.weight),
    reps: String(params.reps),
    unit: params.unit,
    formula: params.formula,
    lift: params.lift,
  });
  return `/1rm?${sp.toString()}`;
}
