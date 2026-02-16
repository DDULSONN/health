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
  if (!body?.status || !["submitted", "reviewing", "matched", "rejected"].includes(body.status)) {
    return NextResponse.json({ error: "올바른 상태값이 아닙니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("dating_applications")
    .update({ status: body.status })
    .eq("id", id);

  if (error) {
    console.error("[PATCH /api/admin/dating/[id]]", error.message);
    return NextResponse.json({ error: "상태 변경 실패" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
