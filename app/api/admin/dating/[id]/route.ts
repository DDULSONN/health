import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("dating_applications")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
  }

  // 사진 signed URL 생성
  const photoUrls: string[] = Array.isArray(data.photo_urls) ? data.photo_urls : [];
  const signedPhotos: string[] = [];
  for (const path of photoUrls) {
    if (typeof path === "string" && path.length > 0) {
      const { data: signed } = await adminClient.storage
        .from("dating-photos")
        .createSignedUrl(path, 600); // 10분
      signedPhotos.push(signed?.signedUrl ?? "");
    }
  }

  return NextResponse.json({
    ...data,
    signed_photos: signedPhotos,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  // 허용 필드 구성
  const updates: Record<string, unknown> = {};

  if (body.status) {
    if (!["submitted", "reviewing", "interview", "matched", "rejected"].includes(body.status)) {
      return NextResponse.json({ error: "올바른 상태값이 아닙니다." }, { status: 400 });
    }
    updates.status = body.status;
  }

  if (typeof body.approved_for_public === "boolean") {
    updates.approved_for_public = body.approved_for_public;
  }
  if (typeof body.display_nickname === "string") {
    updates.display_nickname = body.display_nickname.trim() || null;
  }
  if (typeof body.age === "number") {
    updates.age = body.age;
  }
  if (typeof body.total_3lift === "number") {
    updates.total_3lift = body.total_3lift;
  }
  if (typeof body.percent_all === "number") {
    updates.percent_all = body.percent_all;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "변경할 항목이 없습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("dating_applications")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("[PATCH /api/admin/dating/[id]]", error.message);
    return NextResponse.json({ error: "상태 변경 실패" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
