export const DATING_STORE_PRODUCT_IDS = {
  applyCredits5: "apply_credits_5",
  instantOpenCard: "instant_open_card",
  nearbyIdeal3h: "nearby_ideal_3h",
  moreView3h: "more_view_3h",
  oneOnOneContactExchange: "one_on_one_contact_exchange",
  oneOnOnePriorityRecommendation: "one_on_one_priority_recommendation",
  openCardRepost: "open_card_repost",
  swipePremium15d: "swipe_premium_15d",
  swipePremium30d: "swipe_premium_30d",
} as const;

export type DatingStoreProductId =
  (typeof DATING_STORE_PRODUCT_IDS)[keyof typeof DATING_STORE_PRODUCT_IDS];

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
    hours: 3,
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
  [DATING_STORE_PRODUCT_IDS.openCardRepost]: {
    kind: "open_card_repost",
    amountKrw: 5000,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.swipePremium15d]: {
    kind: "swipe_premium_15d",
    dailyLimit: 15,
    durationDays: 15,
    amountKrw: 10000,
    storeType: "in-app",
  },
  [DATING_STORE_PRODUCT_IDS.swipePremium30d]: {
    kind: "swipe_premium_30d",
    dailyLimit: 15,
    durationDays: 30,
    amountKrw: 10000,
    storeType: "subs",
  },
} as const;
