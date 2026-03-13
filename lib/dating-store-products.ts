export const DATING_STORE_PRODUCT_IDS = {
  applyCredits5: "apply_credits_5",
  instantOpenCard: "instant_open_card",
  nearbyIdeal3h: "nearby_ideal_3h",
  moreView3h: "more_view_3h",
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
} as const;
