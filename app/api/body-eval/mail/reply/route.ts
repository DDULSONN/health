import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type ReplyBody = {
  thread_id?: unknown;
  content?: unknown;
};

function toText(value: unknown, max = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function getKstDayRangeUtc(now = new Date()) {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  const startKstUtcMs = Date.UTC(y, m, d, 0, 0, 0) - 9 * 60 * 60 * 1000;
  const endKstUtcMs = Date.UTC(y, m, d + 1, 0, 0, 0) - 9 * 60 * 60 * 1000;
  return {
    startIso: new Date(startKstUtcMs).toISOString(),
    endIso: new Date(endKstUtcMs).toISOString(),
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as ReplyBody;
  const threadId = toText(body.thread_id, 100);
  const content = toText(body.content, 2000);

  if (!threadId || !content) {
    return NextResponse.json({ ok: false, code: "VALIDATION_ERROR", message: "thread_id와 content를 확인해 주세요." }, { status: 400 });
  }

  const threadRes = await supabase
    .from("body_eval_mail_threads")
    .select("id,author_id,sender_id,status")
    .eq("id", threadId)
    .maybeSingle();
  if (threadRes.error || !threadRes.data) {
    return NextResponse.json({ ok: false, code: "THREAD_NOT_FOUND", message: "대화를 찾을 수 없습니다." }, { status: 404 });
  }

  const thread = threadRes.data;
  if (user.id !== thread.author_id && user.id !== thread.sender_id) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "해당 대화에 참여한 사용자만 답장할 수 있습니다." }, { status: 403 });
  }
  if (thread.status === "closed") {
    return NextResponse.json({ ok: false, code: "THREAD_CLOSED", message: "종료된 대화입니다." }, { status: 400 });
  }

  const range = getKstDayRangeUtc();
  const dailyRes = await supabase
    .from("body_eval_mail_messages")
    .select("id", { head: true, count: "exact" })
    .eq("sender_id", user.id)
    .gte("created_at", range.startIso)
    .lt("created_at", range.endIso);
  if (dailyRes.error) {
    return NextResponse.json({ ok: false, code: "DAILY_LIMIT_CHECK_FAILED", message: "발송 제한 확인에 실패했습니다." }, { status: 500 });
  }
  if ((dailyRes.count ?? 0) >= 10) {
    return NextResponse.json({ ok: false, code: "DAILY_MAIL_LIMIT", message: "하루 발송 한도(10건)를 초과했습니다." }, { status: 429 });
  }

  const receiverId = user.id === thread.author_id ? thread.sender_id : thread.author_id;
  const insertRes = await supabase.from("body_eval_mail_messages").insert({
    thread_id: threadId,
    sender_id: user.id,
    receiver_id: receiverId,
    content,
  });
  if (insertRes.error) {
    return NextResponse.json({ ok: false, code: "REPLY_FAILED", message: "답장 전송에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
