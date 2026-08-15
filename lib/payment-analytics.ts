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
