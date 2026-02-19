import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type SendBody = {
  post_id?: unknown;
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

  const body = ((await req.json().catch(() => null)) ?? {}) as SendBody;
  const postId = toText(body.post_id, 100);
  const content = toText(body.content, 2000);

  if (!postId || !content) {
    return NextResponse.json({ ok: false, code: "VALIDATION_ERROR", message: "post_id와 content를 확인해 주세요." }, { status: 400 });
  }

  const postRes = await supabase
    .from("posts")
    .select("id,user_id,type,is_deleted")
    .eq("id", postId)
    .maybeSingle();
  if (postRes.error || !postRes.data) {
    return NextResponse.json({ ok: false, code: "POST_NOT_FOUND", message: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (postRes.data.type !== "photo_bodycheck" || postRes.data.is_deleted) {
    return NextResponse.json({ ok: false, code: "NOT_BODY_EVAL_POST", message: "몸평 게시글에서만 메일을 보낼 수 있습니다." }, { status: 400 });
  }

  const authorId = String(postRes.data.user_id);
  if (authorId === user.id) {
    return NextResponse.json({ ok: false, code: "SELF_MAIL_BLOCKED", message: "내 글에는 메일을 보낼 수 없습니다." }, { status: 400 });
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

  const threadRes = await supabase
    .from("body_eval_mail_threads")
    .select("id")
    .eq("post_id", postId)
    .eq("sender_id", user.id)
    .maybeSingle();

  let threadId = threadRes.data?.id as string | undefined;
  if (threadRes.error) {
    return NextResponse.json({ ok: false, code: "THREAD_LOAD_FAILED", message: "대화를 불러오지 못했습니다." }, { status: 500 });
  }

  if (!threadId) {
    const createThreadRes = await supabase
      .from("body_eval_mail_threads")
      .insert({
        post_id: postId,
        author_id: authorId,
        sender_id: user.id,
        status: "open",
      })
      .select("id")
      .single();

    if (createThreadRes.error || !createThreadRes.data) {
      // unique(post_id,sender_id) race fallback
      const reload = await supabase
        .from("body_eval_mail_threads")
        .select("id")
        .eq("post_id", postId)
        .eq("sender_id", user.id)
        .maybeSingle();
      if (reload.error || !reload.data) {
        return NextResponse.json({ ok: false, code: "THREAD_CREATE_FAILED", message: "대화 생성에 실패했습니다." }, { status: 500 });
      }
      threadId = reload.data.id;
    } else {
      threadId = createThreadRes.data.id;
    }
  }

  const messageRes = await supabase.from("body_eval_mail_messages").insert({
    thread_id: threadId,
    sender_id: user.id,
    receiver_id: authorId,
    content,
  });
  if (messageRes.error) {
    return NextResponse.json({ ok: false, code: "MESSAGE_SEND_FAILED", message: "메일 전송에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, threadId });
}
