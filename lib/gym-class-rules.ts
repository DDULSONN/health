export const GYM_CLASS_ACTIVE_APPLICATION_STATUSES = ["submitted", "confirmed", "attended"] as const;
export const GYM_CLASS_PAID_APPLICATION_STATUSES = ["paid", "manual_paid"] as const;

export type GymClassGender = "male" | "female" | "other";

export type GymClassCapacityRow = {
  capacity?: number | null;
  male_capacity?: number | null;
  female_capacity?: number | null;
  min_participants?: number | null;
  platform_fee_percent?: number | null;
};

export type GymClassApplicationForStats = {
  status?: string | null;
  gender?: string | null;
  payment_status?: string | null;
  paid_amount_krw?: number | null;
  refund_amount_krw?: number | null;
};

export type GymClassApplicationStats = {
  total: number;
  submitted: number;
  confirmed: number;
  active: number;
  paid: number;
  paidTotalKrw: number;
  refundedTotalKrw: number;
  platformFeeKrw: number;
  operatorSettlementKrw: number;
  male: number;
  female: number;
  other: number;
  remaining: number | null;
  maleRemaining: number | null;
  femaleRemaining: number | null;
  isFull: boolean;
  maleFull: boolean;
  femaleFull: boolean;
  minParticipantsMet: boolean;
};

export function normalizeGymClassGender(value: unknown): GymClassGender | null {
  return value === "male" || value === "female" || value === "other" ? value : null;
}

export function buildDefaultGymClassRefundPolicy(fullDays = 3, halfDays = 2) {
  return `클래스 시작 ${fullDays}일 전까지 전액 환불, ${halfDays}일 전까지 50% 환불이 가능합니다. 하루 전과 당일에는 정원 확보 및 준비 비용으로 환불이 제한될 수 있습니다. 운영자 사정으로 취소되는 경우 전액 환불됩니다.`;
}

export function calculateGymClassRefundPercent(startsAt: string | null | undefined, fullDays = 3, halfDays = 2) {
  if (!startsAt) return 0;
  const startTime = new Date(startsAt).getTime();
  if (Number.isNaN(startTime)) return 0;
  const daysUntilStart = Math.ceil((startTime - Date.now()) / 86_400_000);
  if (daysUntilStart >= fullDays) return 100;
  if (daysUntilStart >= halfDays) return 50;
  return 0;
}

export function buildGymClassApplicationStats(
  applications: GymClassApplicationForStats[],
  capacity: GymClassCapacityRow = {},
): GymClassApplicationStats {
  const activeApplications = applications.filter((application) =>
    GYM_CLASS_ACTIVE_APPLICATION_STATUSES.includes(application.status as (typeof GYM_CLASS_ACTIVE_APPLICATION_STATUSES)[number]),
  );
  const paidApplications = applications.filter((application) =>
    GYM_CLASS_PAID_APPLICATION_STATUSES.includes(application.payment_status as (typeof GYM_CLASS_PAID_APPLICATION_STATUSES)[number]),
  );

  const countGender = (gender: GymClassGender) =>
    activeApplications.filter((application) => application.gender === gender).length;

  const active = activeApplications.length;
  const male = countGender("male");
  const female = countGender("female");
  const other = countGender("other");
  const totalCapacity = capacity.capacity ?? null;
  const maleCapacity = capacity.male_capacity ?? null;
  const femaleCapacity = capacity.female_capacity ?? null;
  const paidTotalKrw = paidApplications.reduce((sum, application) => sum + Math.max(Number(application.paid_amount_krw ?? 0), 0), 0);
  const refundedTotalKrw = applications.reduce((sum, application) => sum + Math.max(Number(application.refund_amount_krw ?? 0), 0), 0);
  const netPaidTotal = Math.max(paidTotalKrw - refundedTotalKrw, 0);
  const platformFeeRate = Math.max(Math.min(Number(capacity.platform_fee_percent ?? 10), 100), 0);
  const platformFeeKrw = Math.floor((netPaidTotal * platformFeeRate) / 100);

  return {
    total: applications.length,
    submitted: applications.filter((application) => application.status === "submitted").length,
    confirmed: applications.filter((application) => application.status === "confirmed").length,
    active,
    paid: paidApplications.length,
    paidTotalKrw,
    refundedTotalKrw,
    platformFeeKrw,
    operatorSettlementKrw: Math.max(netPaidTotal - platformFeeKrw, 0),
    male,
    female,
    other,
    remaining: totalCapacity === null ? null : Math.max(totalCapacity - active, 0),
    maleRemaining: maleCapacity === null ? null : Math.max(maleCapacity - male, 0),
    femaleRemaining: femaleCapacity === null ? null : Math.max(femaleCapacity - female, 0),
    isFull: totalCapacity !== null && active >= totalCapacity,
    maleFull: maleCapacity !== null && male >= maleCapacity,
    femaleFull: femaleCapacity !== null && female >= femaleCapacity,
    minParticipantsMet: capacity.min_participants ? active >= capacity.min_participants : true,
  };
}
