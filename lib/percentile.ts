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

