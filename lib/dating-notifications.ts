import type { SupabaseClient } from "@supabase/supabase-js";
import { sendExpoPushToUser } from "@/lib/expo-push";

type DatingNotificationInput = {
  userId: string;
  actorId?: string | null;
  type: string;
  title: string;
  body: string;
  route: string;
  meta?: Record<string, unknown>;
};

function isNotificationTypeConstraintError(error: {
  code?: string | null;
  message?: string | null;
}) {
  return (
    error.code === "23514" &&
    String(error.message ?? "").includes("notifications_type_check")
  );
}

export async function notifyDatingUser(
  adminClient: SupabaseClient,
  input: DatingNotificationInput
) {
  const metaJson = {
    ...(input.meta ?? {}),
    notification_type: input.type,
    notification_title: input.title,
    notification_body: input.body,
    notification_route: input.route,
  };

  let insertRes = await adminClient.from("notifications").insert({
    user_id: input.userId,
    actor_id: input.actorId ?? null,
    type: input.type,
    post_id: null,
    comment_id: null,
    meta_json: metaJson,
  });

  // Keep alarms working before the expanded type constraint migration is applied.
  if (insertRes.error && isNotificationTypeConstraintError(insertRes.error)) {
    insertRes = await adminClient.from("notifications").insert({
      user_id: input.userId,
      actor_id: input.actorId ?? null,
      type: "comment",
      post_id: null,
      comment_id: null,
      meta_json: metaJson,
    });
  }

  if (insertRes.error) {
    console.error("[notifyDatingUser] notification insert failed", {
      type: input.type,
      userId: input.userId,
      error: insertRes.error,
    });
  }

  const pushResult = await sendExpoPushToUser(adminClient, input.userId, {
    title: input.title,
    body: input.body,
    data: {
      type: input.type,
      route: input.route,
      ...(input.meta ?? {}),
    },
  }).catch((error) => {
    console.error("[notifyDatingUser] push failed", {
      type: input.type,
      userId: input.userId,
      error,
    });
    return { sent: false as const, reason: "request_failed" as const };
  });

  return {
    stored: !insertRes.error,
    pushed: pushResult.sent,
  };
}
