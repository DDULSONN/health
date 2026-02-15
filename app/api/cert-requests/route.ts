import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { makeSubmitCode, normalizeNumber } from "@/lib/certificate";
import { getConfirmedUserOrResponse } from "@/lib/auth-confirmed";

type CreateBody = {
  sex?: "male" | "female";
  bodyweight?: number | null;
  squat?: number;
  bench?: number;
  deadlift?: number;
  video_url?: string | null;
  note?: string;
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET() {
  const supabase = await createClient();
  const guard = await getConfirmedUserOrResponse(supabase);
  if (guard.response) return guard.response;
  const user = guard.user;
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data, error } = await supabase
    .from("cert_requests")
    .select(
      "id, submit_code, status, note, video_url, admin_note, created_at, reviewed_at, sex, bodyweight, squat, bench, deadlift, total, certificates(id, certificate_no, slug, pdf_url, issued_at)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/cert-requests]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const guard = await getConfirmedUserOrResponse(supabase);
  if (guard.response) return guard.response;
  const user = guard.user;
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await request.json()) as CreateBody;
  const sex = body.sex;
  const bodyweight = body.bodyweight == null ? null : Math.max(0, normalizeNumber(body.bodyweight));
  const squat = Math.max(0, normalizeNumber(body.squat));
  const bench = Math.max(0, normalizeNumber(body.bench));
  const deadlift = Math.max(0, normalizeNumber(body.deadlift));
  const videoUrl = body.video_url?.trim() ? body.video_url.trim() : null;

  if (sex !== "male" && sex !== "female") {
    return NextResponse.json({ error: "성별은 필수입니다." }, { status: 400 });
  }
  if (squat <= 0 || bench <= 0 || deadlift <= 0) {
    return NextResponse.json({ error: "스쿼트, 벤치, 데드리프트는 필수입니다." }, { status: 400 });
  }
  if (videoUrl && !isHttpUrl(videoUrl)) {
    return NextResponse.json({ error: "영상 링크는 http/https 형식이어야 합니다." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("user_id", user.id)
    .single();

  let submitCode = makeSubmitCode();
  for (let i = 0; i < 5; i += 1) {
    const { data: existing } = await supabase
      .from("cert_requests")
      .select("id")
      .eq("submit_code", submitCode)
      .maybeSingle();
    if (!existing) break;
    submitCode = makeSubmitCode();
  }

  const { data, error } = await supabase
    .from("cert_requests")
    .insert({
      user_id: user.id,
      nickname: profile?.nickname ?? null,
      email: user.email ?? null,
      sex,
      bodyweight,
      squat,
      bench,
      deadlift,
      total: squat + bench + deadlift,
      video_url: videoUrl,
      submit_code: submitCode,
      status: "pending",
      note: body.note?.trim() ? body.note.trim() : null,
      admin_note: null,
    })
    .select("id, submit_code, status")
    .single();

  if (error) {
    console.error("[POST /api/cert-requests]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ request: data }, { status: 201 });
}
