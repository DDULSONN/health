const TOSS_API_BASE = "https://api.tosspayments.com";

function getBasicAuth(secretKey: string) {
  return Buffer.from(`${secretKey}:`).toString("base64");
}

function getSecretKey() {
  return process.env.TOSS_SECRET_KEY ?? process.env.TOSS_TEST_SECRET_KEY ?? "";
}

export function getTossClientKey() {
  return process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? process.env.NEXT_PUBLIC_TOSS_TEST_CLIENT_KEY ?? "";
}

export function isTossConfigured() {
  return getSecretKey().length > 0;
}

export function getMissingTossConfigKeys() {
  const missingKeys: string[] = [];

  if (!getSecretKey()) {
    missingKeys.push("TOSS_SECRET_KEY");
  }

  return missingKeys;
}

async function tossFetch<T>(path: string, init: RequestInit & { idempotencyKey?: string }) {
  const secretKey = getSecretKey();
  if (!secretKey) {
    throw new Error("TOSS_SECRET_KEY is not configured");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Basic ${getBasicAuth(secretKey)}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept-Language", "en");
  if (init.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  }

  const res = await fetch(`${TOSS_API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as T;

  if (!res.ok) {
    throw new Error(JSON.stringify(body));
  }

  return body;
}

export type TossCreatePaymentParams = {
  method: "CARD";
  amount: number;
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
};

export type TossCreatePaymentResponse = {
  paymentKey?: string;
  checkout?: {
    url?: string;
  };
};

export type TossConfirmPaymentResponse = {
  paymentKey?: string;
  orderId?: string;
  method?: string;
  totalAmount?: number;
  status?: string;
  approvedAt?: string;
};

export async function createTossPayment(params: TossCreatePaymentParams) {
  return tossFetch<TossCreatePaymentResponse>("/v1/payments", {
    method: "POST",
    body: JSON.stringify(params),
    idempotencyKey: crypto.randomUUID(),
  });
}

export async function confirmTossPayment(input: {
  paymentKey: string;
  orderId: string;
  amount: number;
}) {
  return tossFetch<TossConfirmPaymentResponse>("/v1/payments/confirm", {
    method: "POST",
    body: JSON.stringify(input),
    idempotencyKey: crypto.randomUUID(),
  });
}

export const getTossTestClientKey = getTossClientKey;
export const isTossTestConfigured = isTossConfigured;
export const getMissingTossTestConfigKeys = getMissingTossConfigKeys;
export const createTossTestPayment = createTossPayment;
export const confirmTossTestPayment = confirmTossPayment;
