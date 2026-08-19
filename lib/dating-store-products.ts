export const DATING_STORE_PRODUCT_IDS = {
  applyCredits5: "apply_credits_5",
  instantOpenCard: "instant_open_card",
  nearbyIdeal3h: "nearby_ideal_3h",
  moreView3h: "more_view_3h",
  oneOnOneContactExchange: "one_on_one_contact_exchange",
  oneOnOnePriorityRecommendation: "one_on_one_priority_recommendation",
  oneOnOnePlus7d: "one_on_one_plus_7d",
  oneOnOnePlus30d: "one_on_one_plus_30d",
  datingAllPass30d: "dating_all_pass_30d",
  openCardRepost: "open_card_repost",
  swipePremium15d: "swipe_premium_15d",
  swipePremium30d: "swipe_premium_monthly",
} as const;

export const APPLE_DATING_STORE_PRODUCT_IDS = {
  applyCredits5: "gymtools_apply_credits_5_ios",
  instantOpenCard: "gymtools_instant_open_card_ios",
  nearbyIdeal3h: "gymtools_nearby_ideal_3h_ios",
  moreView3h: "gymtools_more_view_3h_ios",
  oneOnOneContactExchange: "gymtools_one_on_one_contact_exchange_ios",
  oneOnOnePlus7d: "gymtools_one_on_one_plus_7d_ios",
  oneOnOnePlus30d: "gymtools_one_on_one_plus_30d_ios",
  datingAllPass30d: "gymtools_dating_all_pass_30d_ios",
  openCardRepost: "gymtools_open_card_repost_ios",
  swipePremium30d: "gymtools_swipe_premium_monthly_ios",
} as const;

export type DatingStoreProductId =
  (typeof DATING_STORE_PRODUCT_IDS)[keyof typeof DATING_STORE_PRODUCT_IDS];

const APPLE_TO_CANONICAL_PRODUCT_ID = {
  [APPLE_DATING_STORE_PRODUCT_IDS.applyCredits5]: DATING_STORE_PRODUCT_IDS.applyCredits5,
  [APPLE_DATING_STORE_PRODUCT_IDS.instantOpenCard]: DATING_STORE_PRODUCT_IDS.instantOpenCard,
  [APPLE_DATING_STORE_PRODUCT_IDS.nearbyIdeal3h]: DATING_STORE_PRODUCT_IDS.nearbyIdeal3h,
  [APPLE_DATING_STORE_PRODUCT_IDS.moreView3h]: DATING_STORE_PRODUCT_IDS.moreView3h,
  [APPLE_DATING_STORE_PRODUCT_IDS.oneOnOneContactExchange]: DATING_STORE_PRODUCT_IDS.oneOnOneContactExchange,
  [APPLE_DATING_STORE_PRODUCT_IDS.oneOnOnePlus7d]: DATING_STORE_PRODUCT_IDS.oneOnOnePlus7d,
  [APPLE_DATING_STORE_PRODUCT_IDS.oneOnOnePlus30d]: DATING_STORE_PRODUCT_IDS.oneOnOnePlus30d,
  [APPLE_DATING_STORE_PRODUCT_IDS.datingAllPass30d]: DATING_STORE_PRODUCT_IDS.datingAllPass30d,
  [APPLE_DATING_STORE_PRODUCT_IDS.openCardRepost]: DATING_STORE_PRODUCT_IDS.openCardRepost,
  [APPLE_DATING_STORE_PRODUCT_IDS.swipePremium30d]: DATING_STORE_PRODUCT_IDS.swipePremium30d,
} as const;

export function normalizeDatingStoreProductId(productId: string): DatingStoreProductId | null {
  const canonicalIds = Object.values(DATING_STORE_PRODUCT_IDS) as string[];
  if (canonicalIds.includes(productId)) return productId as DatingStoreProductId;

  return (
    APPLE_TO_CANONICAL_PRODUCT_ID[productId as keyof typeof APPLE_TO_CANONICAL_PRODUCT_ID] ?? null
  );
}

export function isAppleDatingStoreProductId(productId: string) {
  return Object.prototype.hasOwnProperty.call(APPLE_TO_CANONICAL_PRODUCT_ID, productId);
}

export const DATING_STORE_PRODUCT_CATALOG = {
  [DATING_STORE_PRODUCT_IDS.applyCredits5]: {
    kind: "apply_credits",
    credits: 5,
  },
  [DATING_STORE_PRODUCT_IDS.instantOpenCard]: {
    kind: "instant_open_card",
  },
  [DATING_STORE_PRODUCT_IDS.nearbyIdeal3h]: {
    kind: "nearby_ideal_3h",
    hours: 24,
    bonusCredits: 1,
  },
  [DATING_STORE_PRODUCT_IDS.moreView3h]: {
    kind: "more_view_3h",
    hours: 3,
    bonusCredits: 1,
  },
  [DATING_STORE_PRODUCT_IDS.oneOnOneContactExchange]: {
    kind: "one_on_one_contact_exchange",
    amountKrw: 20000,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.oneOnOnePriorityRecommendation]: {
    kind: "one_on_one_priority_recommendation",
    amountKrw: 5000,
    durationDays: 3,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.oneOnOnePlus7d]: {
    kind: "one_on_one_plus_7d",
    amountKrw: 9900,
    durationDays: 7,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.oneOnOnePlus30d]: {
    kind: "one_on_one_plus_30d",
    amountKrw: 30000,
    durationDays: 30,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.datingAllPass30d]: {
    kind: "dating_all_pass_30d",
    amountKrw: 39900,
    swipePremiumAmountKrw: 30000,
    durationDays: 30,
    dailyLimit: 30,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.openCardRepost]: {
    kind: "open_card_repost",
    amountKrw: 5000,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.swipePremium15d]: {
    kind: "swipe_premium_15d",
    dailyLimit: 30,
    durationDays: 30,
    amountKrw: 30000,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.swipePremium30d]: {
    kind: "swipe_premium_30d",
    dailyLimit: 30,
    durationDays: 30,
    amountKrw: 30000,
    storeType: "subs",
  },
} as const;
