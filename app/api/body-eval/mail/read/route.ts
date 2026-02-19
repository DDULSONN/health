import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ReadBody = {
  message_id?: unknown;
  thread_id?: unknown;
};

function toText(value: unknown, max = 100) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as ReadBody;
  const messageId = toText(body.message_id);
  const threadId = toText(body.thread_id);
  if (!messageId && !threadId) {
    return NextResponse.json({ ok: false, code: "VALIDATION_ERROR", message: "message_id 또는 thread_id가 필요합니다." }, { status: 400 });
  }

  let updateRes;
  if (messageId) {
    updateRes = await supabase
      .from("body_eval_mail_messages")
      .update({ is_read: true })
      .eq("id", messageId)
      .eq("receiver_id", user.id)
      .eq("is_read", false);
  } else {
    updateRes = await supabase
      .from("body_eval_mail_messages")
      .update({ is_read: true })
      .eq("thread_id", threadId)
      .eq("receiver_id", user.id)
      .eq("is_read", false);
  }

  if (updateRes.error) {
    return NextResponse.json({ ok: false, code: "READ_UPDATE_FAILED", message: "읽음 처리에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
