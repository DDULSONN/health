import { kgToLb, lbToKg, type WeightUnit } from "./oneRm";
import type { Sex } from "./percentile";

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
  ratio: number;
  grade: GradeInfo;
}

export interface GradeInfo {
  label: string;
  color: string;
  description: string;
}

const GRADES: { minRatio: number; info: GradeInfo }[] = [
  {
    minRatio: 8.0,
    info: {
      label: "전설",
      color: "text-yellow-500",
      description: "엘리트 파워리프터급 퍼포먼스",
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
      description: "지속적인 훈련이 만든 상급자",
    },
  },
  {
    minRatio: 4.0,
    info: {
      label: "중급",
      color: "text-blue-500",
      description: "꾸준한 운동으로 다져진 수준",
    },
  },
  {
    minRatio: 3.0,
    info: {
      label: "초중급",
      color: "text-emerald-500",
      description: "기초가 잡힌 트레이닝 단계",
    },
  },
  {
    minRatio: 0,
    info: {
      label: "입문",
      color: "text-neutral-500",
      description: "지금부터 시작해도 충분히 성장할 수 있어요",
    },
  },
];

export function getGrade(ratio: number): GradeInfo {
  for (const grade of GRADES) {
    if (ratio >= grade.minRatio) return grade.info;
  }
  return GRADES[GRADES.length - 1].info;
}

export function calculateLifts(input: LiftInput): LiftResult {
  const { squat, bench, deadlift, bodyweight, unit } = input;

  const totalInUnit = squat + bench + deadlift;
  const totalKg = unit === "kg" ? totalInUnit : lbToKg(totalInUnit);
  const totalLb = unit === "lb" ? totalInUnit : kgToLb(totalInUnit);
  const bodyweightKg = unit === "kg" ? bodyweight : lbToKg(bodyweight);

  const ratio = bodyweightKg > 0 ? totalKg / bodyweightKg : 0;
  const grade = getGrade(ratio);

  return {
    totalKg: Math.round(totalKg * 10) / 10,
    totalLb: Math.round(totalLb * 10) / 10,
    ratio: Math.round(ratio * 100) / 100,
    grade,
  };
}

export function buildLiftsShareUrl(input: LiftInput, options?: { sex?: Sex }): string {
  const searchParams = new URLSearchParams({
    s: String(input.squat),
    b: String(input.bench),
    d: String(input.deadlift),
    bw: String(input.bodyweight),
    unit: input.unit,
  });

  if (options?.sex) {
    searchParams.set("sex", options.sex);
  }

  return `/lifts?${searchParams.toString()}`;
}

