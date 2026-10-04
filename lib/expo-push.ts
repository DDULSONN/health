import type { SupabaseClient } from "@supabase/supabase-js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(value: string | null | undefined) {
  if (!value) return false;
  return /^ExponentPushToken\[[^\]]+\]$/.test(value) || /^ExpoPushToken\[[^\]]+\]$/.test(value);
}

export async function sendExpoPushToUser(
  adminClient: SupabaseClient,
  userId: string,
  payload: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }
) {
  const profileRes = await adminClient
    .from("profiles")
    .select("push_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileRes.error) {
    if (profileRes.error.message?.includes("push_token")) {
      return { sent: false, reason: "missing_column" as const };
    }
    throw profileRes.error;
  }

  const pushToken = typeof profileRes.data?.push_token === "string" ? profileRes.data.push_token : null;
  if (!isExpoPushToken(pushToken)) {
    return { sent: false, reason: "missing_token" as const };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      to: pushToken,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      sound: "default",
      channelId: "default",
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Expo push request failed: ${response.status} ${text}`.trim());
  }

  // HTTP 200 can still contain a rejected Expo ticket (e.g. DeviceNotRegistered).
  const body: unknown = await response.json().catch(() => null);
  const result = body && typeof body === "object" ? body as { data?: unknown; errors?: unknown } : null;
  const tickets = Array.isArray(result?.data) ? result.data : result?.data ? [result.data] : [];
  const accepted = tickets.length === 1 && tickets.every((ticket: unknown) =>
    ticket !== null && typeof ticket === "object" &&
    (ticket as { status?: unknown }).status === "ok" &&
    typeof (ticket as { id?: unknown }).id === "string" && Boolean((ticket as { id?: string }).id)
  );
  if (!accepted || (Array.isArray(result?.errors) && result.errors.length > 0)) {
    return { sent: false as const, reason: "ticket_rejected" as const };
  }
  // A ticket confirms provider acceptance, not delivery to the handset.
  return { sent: true as const };
}
