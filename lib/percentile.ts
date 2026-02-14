import { getWeightClass, type WeightClassKey } from "./weightClass";

export type Sex = "male" | "female";

export interface DistributionParams {
  mean: number;
  std: number;
}

const MIN_TOP_PERCENT = 0.1;
const MAX_TOP_PERCENT = 99.9;
const PERCENT_DECIMALS = 1;

// Easy-to-tune model params for percentile estimation.
export const PERCENTILE_MODEL = {
  ALL_KR: {
    male: { mean: 230, std: 120 },
    female: { mean: 120, std: 70 },
  },
  GYM_KR: {
    male: { mean: 360, std: 100 },
    female: { mean: 190, std: 65 },
  },
} as const satisfies Record<string, Record<Sex, DistributionParams>>;

// Class-based estimated model (sex + weight class).
export const WEIGHT_CLASS_PERCENTILE_MODEL: Record<Sex, Partial<Record<WeightClassKey, DistributionParams>>> = {
  male: {
    m_lt_67: { mean: 320, std: 80 },
    m_67_74: { mean: 355, std: 82 },
    m_74_83: { mean: 390, std: 85 },
    m_83_93: { mean: 420, std: 90 },
    m_93_105: { mean: 445, std: 95 },
    m_gte_105: { mean: 470, std: 105 },
  },
  female: {
    f_lt_57: { mean: 170, std: 45 },
    f_57_63: { mean: 200, std: 50 },
    f_63_69: { mean: 225, std: 55 },
    f_69_76: { mean: 245, std: 58 },
    f_gte_76: { mean: 265, std: 62 },
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Abramowitz and Stegun approximation for erf(x)
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));
  return sign * y;
}

function normalCdf(x: number, mean: number, std: number): number {
  if (std <= 0) return x >= mean ? 1 : 0;
  const z = (x - mean) / (std * Math.sqrt(2));
  return 0.5 * (1 + erf(z));
}

export function calcPercentile(total: number, params: DistributionParams): number {
  const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
  const cdf = normalCdf(safeTotal, params.mean, params.std);
  const topPercent = (1 - cdf) * 100;
  return round(clamp(topPercent, MIN_TOP_PERCENT, MAX_TOP_PERCENT), PERCENT_DECIMALS);
}

export function getPercentiles(total: number, sex: Sex): { allKrTop: number; gymKrTop: number } {
  return {
    allKrTop: calcPercentile(total, PERCENTILE_MODEL.ALL_KR[sex]),
    gymKrTop: calcPercentile(total, PERCENTILE_MODEL.GYM_KR[sex]),
  };
}

export function getClassBasedPercentile(
  total: number,
  sex: Sex,
  weightKg: number,
): { topPercent: number; classLabel: string; classKey: WeightClassKey } | null {
  const weightClass = getWeightClass(sex, weightKg);
  if (!weightClass) return null;

  const params = WEIGHT_CLASS_PERCENTILE_MODEL[sex][weightClass.key];
  if (!params) return null;
  return {
    topPercent: calcPercentile(total, params),
    classLabel: weightClass.label,
    classKey: weightClass.key,
  };
}
