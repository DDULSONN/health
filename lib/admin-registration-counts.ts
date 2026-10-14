export type RegistrationFeatureKey = "open_card_created" | "one_on_one_created";

export type RegistrationSexCounts = {
  male: number;
  female: number;
  unknown: number;
};

export type RegistrationSexBreakdown = Record<RegistrationFeatureKey, RegistrationSexCounts>;

export function isRegistrationFeatureKey(key: string): key is RegistrationFeatureKey {
  return key === "open_card_created" || key === "one_on_one_created";
}

export function createRegistrationSexBreakdown(): RegistrationSexBreakdown {
  return {
    open_card_created: { male: 0, female: 0, unknown: 0 },
    one_on_one_created: { male: 0, female: 0, unknown: 0 },
  };
}

export function addRegistrationSexCount(counts: RegistrationSexCounts, sex: unknown) {
  counts[sex === "male" || sex === "female" ? sex : "unknown"] += 1;
}
