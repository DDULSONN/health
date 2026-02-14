import type { Sex } from "./percentile";

type WeightClassRange = {
  key: string;
  min: number;
  max: number;
  label: string;
};

const MALE_WEIGHT_CLASSES: WeightClassRange[] = [
  { key: "m_lt_67", min: 0, max: 67, label: "<67kg" },
  { key: "m_67_74", min: 67, max: 74, label: "67~74kg" },
  { key: "m_74_83", min: 74, max: 83, label: "74~83kg" },
  { key: "m_83_93", min: 83, max: 93, label: "83~93kg" },
  { key: "m_93_105", min: 93, max: 105, label: "93~105kg" },
  { key: "m_gte_105", min: 105, max: Number.POSITIVE_INFINITY, label: "105kg+" },
];

const FEMALE_WEIGHT_CLASSES: WeightClassRange[] = [
  { key: "f_lt_57", min: 0, max: 57, label: "<57kg" },
  { key: "f_57_63", min: 57, max: 63, label: "57~63kg" },
  { key: "f_63_69", min: 63, max: 69, label: "63~69kg" },
  { key: "f_69_76", min: 69, max: 76, label: "69~76kg" },
  { key: "f_gte_76", min: 76, max: Number.POSITIVE_INFINITY, label: "76kg+" },
];

export type WeightClassKey = (typeof MALE_WEIGHT_CLASSES)[number]["key"] | (typeof FEMALE_WEIGHT_CLASSES)[number]["key"];

export function getWeightClass(sex: Sex, weightKg: number): { key: WeightClassKey; label: string } | null {
  const safeWeight = Number.isFinite(weightKg) ? Math.max(0, weightKg) : 0;
  if (safeWeight <= 0) return null;

  const classes = sex === "male" ? MALE_WEIGHT_CLASSES : FEMALE_WEIGHT_CLASSES;
  const match = classes.find((item) => safeWeight >= item.min && safeWeight < item.max);
  if (!match) return null;

  return { key: match.key as WeightClassKey, label: match.label };
}

