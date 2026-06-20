import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { decodeJwt, importPKCS8, SignJWT } from "jose";
import {
  approvePaidCard,
  grantApplyCredits,
  grantCityViewAccess,
  grantMoreViewAccess,
  grantOneOnOneContactExchange,
  grantOneOnOnePriorityBoost,
  grantOpenCardRepost,
  grantSwipeSubscription,
} from "@/lib/dating-purchase-fulfillment";
import {
  DATING_STORE_PRODUCT_CATALOG,
  DATING_STORE_PRODUCT_IDS,
  type DatingStoreProductId,
} from "@/lib/dating-store-products";
import { extractProvinceFromRegion } from "@/lib/region-city";
import { createAdminClient } from "@/lib/supabase/server";

export type DirectStorePlatform = "ios" | "android";

export type DirectStorePurchaseInput = {
  platform: DirectStorePlatform;
  productId: string;
  purchaseToken?: string | null;
  transactionId?: string | null;
  originalTransactionId?: string | null;
  rawPurchase?: Record<string, unknown> | null;
  attributes?: Record<string, string | null | undefined>;
};

export type DirectStoreVerificationResult = {
  store: "app_store" | "play_store";
  productId: DatingStoreProductId;
  eventKey: string;
  purchaseToken: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  verificationJson: Record<string, unknown>;
};

type AdminClient = ReturnType<typeof createAdminClient>;

function normalizeProductId(productId: string): DatingStoreProductId | null {
  return Object.values(DATING_STORE_PRODUCT_IDS).includes(productId as DatingStoreProductId)
    ? (productId as DatingStoreProductId)
    : null;
}

function isSubscriptionProduct(productId: DatingStoreProductId) {
  const product = DATING_STORE_PRODUCT_CATALOG[productId];
  return "storeType" in product && product.storeType === "subs";
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildPurchaseEventKey(input: {
  platform: DirectStorePlatform;
  purchaseToken?: string | null;
  transactionId?: string | null;
  originalTransactionId?: string | null;
}) {
  const tx = String(input.transactionId ?? "").trim();
  const originalTx = String(input.originalTransactionId ?? "").trim();
  const token = String(input.purchaseToken ?? "").trim();
  const seed = tx || originalTx || (token ? hashValue(token) : "");
  if (!seed) {
    throw new Error("결제 식별값이 없습니다.");
  }
  return `${input.platform}:${seed}`;
}

function normalizeAttributes(attributes: DirectStorePurchaseInput["attributes"]) {
  return Object.entries(attributes ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string" && value.trim()) {
      acc[key] = value.trim();
    }
    return acc;
  }, {});
}

function decodeTransactionToken(purchaseToken: string | null | undefined) {
  const token = String(purchaseToken ?? "").trim();
  if (!token) return null;

  try {
    return decodeJwt(token) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readGoogleServiceAccountJson() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (!raw) return null;

  const maybeJson = raw.startsWith("{")
    ? raw
    : raw.startsWith("ey") || raw.includes("base64")
      ? Buffer.from(raw.replace(/^base64:/, ""), "base64").toString("utf8")
      : readFileSync(raw, "utf8");

  return JSON.parse(maybeJson) as Record<string, unknown>;
}

async function verifyAndroidPlayPurchase(input: DirectStorePurchaseInput & { productId: DatingStoreProductId }) {
  const purchaseToken = String(input.purchaseToken ?? "").trim();
  if (!purchaseToken) {
    throw new Error("안드로이드 purchaseToken이 필요합니다.");
  }

  const credentials = readGoogleServiceAccountJson();
  if (!credentials) {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON 환경변수가 필요합니다.");
  }

  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || "com.helchang.dating";
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });

  const publisher = google.androidpublisher({ version: "v3", auth });

  if (isSubscriptionProduct(input.productId)) {
    const response = await publisher.purchases.subscriptionsv2.get({
      packageName,
      token: purchaseToken,
    });

    const purchase = response.data ?? {};
    const lineItems = Array.isArray(purchase.lineItems) ? purchase.lineItems : [];
    const matchingLineItem =
      lineItems.find((item) => String(item.productId ?? "").trim() === input.productId) ?? lineItems[0] ?? null;
    const expiresAt = String(matchingLineItem?.expiryTime ?? "").trim() || null;
    const subscriptionState = String(purchase.subscriptionState ?? "").trim() || null;
    const nowMs = Date.now();
    const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
    const allowedStates = new Set([
      "SUBSCRIPTION_STATE_ACTIVE",
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
      "SUBSCRIPTION_STATE_PAUSED",
    ]);

    if (!expiresAt || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
      throw new Error("Google Play 구독 만료 정보가 유효하지 않습니다.");
    }

    if (subscriptionState && !allowedStates.has(subscriptionState)) {
      throw new Error("Google Play 구독이 현재 활성 상태가 아닙니다.");
    }

    return {
      store: "play_store" as const,
      productId: input.productId,
      purchaseToken,
      transactionId:
        String(matchingLineItem?.latestSuccessfulOrderId ?? purchase.latestOrderId ?? input.transactionId ?? "").trim() ||
        null,
      originalTransactionId: null,
      verificationJson: {
        packageName,
        subscriptionState,
        acknowledgementState: purchase.acknowledgementState ?? null,
        startTime: purchase.startTime ?? null,
        latestOrderId: purchase.latestOrderId ?? null,
        expiryTime: expiresAt,
        lineItems,
        raw: purchase,
      },
    };
  }

  const response = await publisher.purchases.products.get({
    packageName,
    productId: input.productId,
    token: purchaseToken,
  });

  const purchase = response.data ?? {};
  const purchaseState = Number(purchase.purchaseState ?? 1);
  if (purchaseState !== 0) {
    throw new Error("Google Play 결제가 아직 완료 상태가 아닙니다.");
  }

  return {
    store: "play_store" as const,
    productId: input.productId,
    purchaseToken,
    transactionId: String(purchase.orderId ?? input.transactionId ?? "").trim() || null,
    originalTransactionId: null,
    verificationJson: {
      packageName,
      orderId: purchase.orderId ?? null,
      purchaseState,
      purchaseTimeMillis: purchase.purchaseTimeMillis ?? null,
      consumptionState: purchase.consumptionState ?? null,
      acknowledgementState: purchase.acknowledgementState ?? null,
      regionCode: purchase.regionCode ?? null,
      raw: purchase,
    },
  };
}

async function signAppleStoreServerJwt() {
  const issuerId = process.env.APPLE_IAP_ISSUER_ID?.trim() ?? "";
  const keyId = process.env.APPLE_IAP_KEY_ID?.trim() ?? "";
  const privateKey = (process.env.APPLE_IAP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();

  if (!issuerId || !keyId || !privateKey) {
    throw new Error("APPLE_IAP_ISSUER_ID, APPLE_IAP_KEY_ID, APPLE_IAP_PRIVATE_KEY 환경변수가 필요합니다.");
  }

  const signingKey = await importPKCS8(privateKey, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuer(issuerId)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signingKey);
}

async function fetchAppleTransactionInfo(transactionId: string) {
  const token = await signAppleStoreServerJwt();
  const urls = [
    `https://api.storekit.itunes.apple.com/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    `https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
  ];

  let lastErrorText = "";

  for (const url of urls) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (response.ok) {
      return {
        environment: url.includes("sandbox") ? "sandbox" : "production",
        body: (await response.json()) as Record<string, unknown>,
      };
    }

    lastErrorText = await response.text().catch(() => "");
    if (response.status !== 404) {
      break;
    }
  }

  throw new Error(lastErrorText || "App Store 서버에서 거래 조회에 실패했습니다.");
}

async function verifyApplePurchase(input: DirectStorePurchaseInput & { productId: DatingStoreProductId }) {
  const bundleId = process.env.APPLE_IAP_BUNDLE_ID?.trim() || "com.helchang.dating";
  const decodedClientToken = decodeTransactionToken(input.purchaseToken);
  const transactionId =
    String(input.transactionId ?? "").trim() ||
    String(decodedClientToken?.transactionId ?? "").trim() ||
    String(decodedClientToken?.originalTransactionId ?? "").trim();

  if (!transactionId) {
    throw new Error("iOS transactionId가 필요합니다.");
  }

  const { body, environment } = await fetchAppleTransactionInfo(transactionId);
  const signedTransactionInfo = String(body.signedTransactionInfo ?? "").trim();
  if (!signedTransactionInfo) {
    throw new Error("App Store 거래 응답이 올바르지 않습니다.");
  }

  const decoded = decodeJwt(signedTransactionInfo) as Record<string, unknown>;
  const verifiedBundleId = String(decoded.bundleId ?? "");
  const verifiedProductId = String(decoded.productId ?? "");
  const expiresDate = Number(decoded.expiresDate ?? 0);

  if (verifiedBundleId && verifiedBundleId !== bundleId) {
    throw new Error("App Store bundle identifier가 일치하지 않습니다.");
  }
  if (verifiedProductId && verifiedProductId !== input.productId) {
    throw new Error("App Store product identifier가 일치하지 않습니다.");
  }
  if (isSubscriptionProduct(input.productId) && (!Number.isFinite(expiresDate) || expiresDate <= Date.now())) {
    throw new Error("App Store 구독이 현재 활성 상태가 아닙니다.");
  }

  return {
    store: "app_store" as const,
    productId: input.productId,
    purchaseToken: String(input.purchaseToken ?? "").trim() || signedTransactionInfo,
    transactionId: String(decoded.transactionId ?? transactionId),
    originalTransactionId: String(decoded.originalTransactionId ?? input.originalTransactionId ?? "").trim() || null,
    verificationJson: {
      environment,
      bundleId: verifiedBundleId || null,
      productId: verifiedProductId || null,
      appAccountToken: decoded.appAccountToken ?? null,
      transactionId: decoded.transactionId ?? transactionId,
      originalTransactionId: decoded.originalTransactionId ?? null,
      purchaseDate: decoded.purchaseDate ?? null,
      expiresDate: Number.isFinite(expiresDate) ? expiresDate : null,
      quantity: decoded.quantity ?? null,
      type: decoded.type ?? null,
      inAppOwnershipType: decoded.inAppOwnershipType ?? null,
      raw: body,
      decodedTransaction: decoded,
    },
  };
}

export async function verifyDirectStorePurchase(input: DirectStorePurchaseInput): Promise<DirectStoreVerificationResult> {
  const productId = normalizeProductId(input.productId);
  if (!productId || !DATING_STORE_PRODUCT_CATALOG[productId]) {
    throw new Error("지원하지 않는 결제 상품 ID입니다.");
  }

  const verified =
    input.platform === "android"
      ? await verifyAndroidPlayPurchase({ ...input, productId })
      : await verifyApplePurchase({ ...input, productId });

  return {
    ...verified,
    eventKey: buildPurchaseEventKey({
      platform: input.platform,
      purchaseToken: verified.purchaseToken,
      transactionId: verified.transactionId,
      originalTransactionId: verified.originalTransactionId,
    }),
  };
}

export async function fulfillDatingStorePurchase(
  admin: AdminClient,
  input: {
    userId: string;
    productId: DatingStoreProductId;
    platform: DirectStorePlatform;
    eventKey: string;
    attributes?: Record<string, string | null | undefined>;
    verificationJson?: Record<string, unknown>;
  }
) {
  const attributes = normalizeAttributes(input.attributes);
  const note = `source=direct_store platform=${input.platform} event=${input.eventKey}`;

  if (input.productId === DATING_STORE_PRODUCT_IDS.applyCredits5) {
    return grantApplyCredits(admin, input.userId, 5);
  }

  if (input.productId === DATING_STORE_PRODUCT_IDS.nearbyIdeal3h) {
    const provinceRaw = attributes.dating_nearby_province ?? "";
    const province = extractProvinceFromRegion(provinceRaw) ?? provinceRaw.trim();
    if (!province) {
      throw new Error("dating_nearby_province 값이 필요합니다.");
    }

    return grantCityViewAccess(admin, {
      userId: input.userId,
      city: province,
      accessHours: 3,
      bonusCredits: 1,
      note,
    });
  }

  if (input.productId === DATING_STORE_PRODUCT_IDS.moreView3h) {
    const sex =
      attributes.dating_more_view_sex === "female"
        ? "female"
        : attributes.dating_more_view_sex === "male"
          ? "male"
          : null;
    if (!sex) {
      throw new Error("dating_more_view_sex 값이 필요합니다.");
    }

    return grantMoreViewAccess(admin, {
      userId: input.userId,
      sex,
      accessHours: 3,
      bonusCredits: 1,
      note,
    });
  }

  if (input.productId === DATING_STORE_PRODUCT_IDS.instantOpenCard) {
    const paidCardId = attributes.dating_paid_card_id ?? "";
    if (!paidCardId) {
      throw new Error("dating_paid_card_id 값이 필요합니다.");
    }

    const result = await approvePaidCard(admin, {
      paidCardId,
      displayMode: "instant_public",
    });

    if (!result) {
      throw new Error("즉시 등록 대상 카드를 찾지 못했습니다.");
    }

    return result;
  }

  if (input.productId === DATING_STORE_PRODUCT_IDS.oneOnOneContactExchange) {
    const matchId = attributes.dating_1on1_match_id ?? "";
    if (!matchId) {
      throw new Error("dating_1on1_match_id 값이 필요합니다.");
    }

    return grantOneOnOneContactExchange(admin, {
      matchId,
      userId: input.userId,
      note,
    });
  }

  if (input.productId === DATING_STORE_PRODUCT_IDS.oneOnOnePriorityRecommendation) {
    const cardId = attributes.dating_1on1_card_id ?? "";
    if (!cardId) {
      throw new Error("dating_1on1_card_id 값이 필요합니다.");
    }

    return grantOneOnOnePriorityBoost(admin, {
      cardId,
      userId: input.userId,
      durationDays: DATING_STORE_PRODUCT_CATALOG[input.productId].durationDays,
      note,
    });
  }

  if (input.productId === DATING_STORE_PRODUCT_IDS.openCardRepost) {
    const cardId = attributes.dating_open_card_id ?? "";
    if (!cardId) {
      throw new Error("dating_open_card_id 값이 필요합니다.");
    }

    return grantOpenCardRepost(admin, {
      cardId,
      userId: input.userId,
      note,
    });
  }

  if (input.productId === DATING_STORE_PRODUCT_IDS.swipePremium15d) {
    return grantSwipeSubscription(admin, {
      userId: input.userId,
      amount: DATING_STORE_PRODUCT_CATALOG[input.productId].amountKrw,
      dailyLimit: DATING_STORE_PRODUCT_CATALOG[input.productId].dailyLimit,
      durationDays: DATING_STORE_PRODUCT_CATALOG[input.productId].durationDays,
      note,
    });
  }

  if (input.productId === DATING_STORE_PRODUCT_IDS.swipePremium30d) {
    const verificationJson = input.verificationJson ?? {};
    const expiresAt =
      typeof verificationJson.expiryTime === "string" && verificationJson.expiryTime.trim()
        ? verificationJson.expiryTime.trim()
        : Number.isFinite(Number(verificationJson.expiresDate ?? 0))
          ? new Date(Number(verificationJson.expiresDate)).toISOString()
          : null;

    return grantSwipeSubscription(admin, {
      userId: input.userId,
      amount: 10000,
      dailyLimit: 15,
      durationDays: 30,
      expiresAt,
      note,
    });
  }

  throw new Error("지원하지 않는 상품입니다.");
}
