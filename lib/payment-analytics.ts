type AnalyticsItem = {
  itemId: string;
  itemName?: string | null;
  amount: number;
  placement?: string | null;
};

type GtagWindow = Window & {
  gtag?: (...args: unknown[]) => void;
};

function sendEvent(eventName: string, params: Record<string, unknown>) {
  if (typeof window === "undefined") return false;
  const gtag = (window as GtagWindow).gtag;
  if (typeof gtag !== "function") return false;
  gtag("event", eventName, params);
  return true;
}

function getAnalyticsSessionId() {
  if (typeof window === "undefined") return "";
  const storageKey = "gymtools-payment-funnel-session";
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const next = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    window.sessionStorage.setItem(storageKey, next);
    return next;
  } catch {
    return "";
  }
}

function recordInternalEvent(eventName: "view_item" | "select_item", item: AnalyticsItem) {
  if (typeof window === "undefined") return;

  const sessionId = getAnalyticsSessionId();
  const dedupeKey = `gymtools-payment-funnel:${eventName}:${item.itemId}:${item.placement ?? "default"}`;
  try {
    if (window.sessionStorage.getItem(dedupeKey) === "1") return;
    window.sessionStorage.setItem(dedupeKey, "1");
  } catch {
    // A blocked storage API should not prevent the event attempt.
  }

  void fetch("/api/analytics/payment-funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify({
      eventName,
      itemId: item.itemId,
      itemName: item.itemName ?? null,
      amount: item.amount,
      placement: item.placement ?? null,
      sessionId,
    }),
  }).catch(() => {
    // Analytics must never interrupt the product flow.
  });
}

export function trackCheckoutStarted(item: AnalyticsItem) {
  sendEvent("begin_checkout", {
    currency: "KRW",
    value: item.amount,
    items: [
      {
        item_id: item.itemId,
        item_name: item.itemName ?? item.itemId,
        price: item.amount,
        quantity: 1,
        item_list_name: item.placement ?? undefined,
      },
    ],
  });
}

export function trackPaidOfferViewed(item: AnalyticsItem) {
  recordInternalEvent("view_item", item);
  sendEvent("view_item", {
    currency: "KRW",
    value: item.amount,
    items: [
      {
        item_id: item.itemId,
        item_name: item.itemName ?? item.itemId,
        price: item.amount,
        quantity: 1,
        item_list_name: item.placement ?? undefined,
      },
    ],
  });
}

export function trackPaidOfferSelected(item: AnalyticsItem) {
  recordInternalEvent("select_item", item);
  sendEvent("select_item", {
    item_list_name: item.placement ?? "paid_offer",
    items: [
      {
        item_id: item.itemId,
        item_name: item.itemName ?? item.itemId,
        price: item.amount,
        quantity: 1,
      },
    ],
  });
}

export function trackPurchaseCompleted(item: AnalyticsItem & { orderId: string }) {
  if (typeof window === "undefined") return;
  const storageKey = `gymtools-ga-purchase:${item.orderId}`;
  try {
    if (window.localStorage.getItem(storageKey) === "1") return;
  } catch {
    // Analytics must never interrupt a completed payment.
  }

  const sent = sendEvent("purchase", {
    transaction_id: item.orderId,
    currency: "KRW",
    value: item.amount,
    items: [
      {
        item_id: item.itemId,
        item_name: item.itemName ?? item.itemId,
        price: item.amount,
        quantity: 1,
      },
    ],
  });

  if (sent) {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Analytics must never interrupt a completed payment.
    }
  }
}
