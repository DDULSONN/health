/**
 * 3대 합계 / 체중비 계산 + 등급 판정
 */

import { kgToLb, lbToKg, type WeightUnit } from "./oneRm";

export interface LiftInput {
  squat: number;
  bench: number;
  deadlift: number;
  bodyweight: number;
  unit: WeightUnit;
}

export interface LiftResult {
  totalKg: number;
  totalLb: number;
  ratio: number; // total / bodyweight
  grade: GradeInfo;
}

export interface GradeInfo {
  label: string;
  color: string;
  description: string;
}

/** 등급 기준 (체중 대비 3대 합계 비율) */
const GRADES: { minRatio: number; info: GradeInfo }[] = [
  {
    minRatio: 8.0,
    info: {
      label: "전설",
      color: "text-yellow-500",
      description: "엘리트 파워리프터 수준",
    },
  },
  {
    minRatio: 6.5,
    info: {
      label: "괴물",
      color: "text-red-500",
      description: "상위 1% 수준의 근력",
    },
  },
  {
    minRatio: 5.0,
    info: {
      label: "고급",
      color: "text-purple-500",
      description: "진지한 리프터 수준",
    },
  },
  {
    minRatio: 4.0,
    info: {
      label: "중급",
      color: "text-blue-500",
      description: "꾸준히 훈련한 수준",
    },
  },
  {
    minRatio: 3.0,
    info: {
      label: "초중급",
      color: "text-emerald-500",
      description: "기초가 잡힌 수준",
    },
  },
  {
    minRatio: 0,
    info: {
      label: "입문",
      color: "text-neutral-500",
      description: "시작이 반! 꾸준히 하면 금방 올라요",
    },
  },
];

/** 비율 기반 등급 판정 */
export function getGrade(ratio: number): GradeInfo {
  for (const g of GRADES) {
    if (ratio >= g.minRatio) return g.info;
  }
  return GRADES[GRADES.length - 1].info;
}

/** 3대 합계 계산 */
export function calculateLifts(input: LiftInput): LiftResult {
  const { squat, bench, deadlift, bodyweight, unit } = input;

  const totalInUnit = squat + bench + deadlift;
  const totalKg = unit === "kg" ? totalInUnit : lbToKg(totalInUnit);
  const totalLb = unit === "lb" ? totalInUnit : kgToLb(totalInUnit);
  const bwKg = unit === "kg" ? bodyweight : lbToKg(bodyweight);

  const ratio = bwKg > 0 ? totalKg / bwKg : 0;
  const grade = getGrade(ratio);

  return {
    totalKg: Math.round(totalKg * 10) / 10,
    totalLb: Math.round(totalLb * 10) / 10,
    ratio: Math.round(ratio * 100) / 100,
    grade,
  };
}

/** 공유 URL 생성 */
export function buildLiftsShareUrl(input: LiftInput): string {
  const sp = new URLSearchParams({
    s: String(input.squat),
    b: String(input.bench),
    d: String(input.deadlift),
    bw: String(input.bodyweight),
    unit: input.unit,
  });
  return `/lifts?${sp.toString()}`;
}
