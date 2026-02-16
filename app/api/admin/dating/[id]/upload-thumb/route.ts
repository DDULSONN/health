import { isAdminEmail } from "@/lib/admin";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(
  request: Request,
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

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "5MB 이하의 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "JPG, PNG, WebP만 업로드할 수 있습니다." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: app } = await adminClient
    .from("dating_applications")
    .select("id, user_id")
    .eq("id", id)
    .single();

  if (!app) {
    return NextResponse.json({ error: "신청을 찾을 수 없습니다." }, { status: 404 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const storagePath = `dating/${app.user_id}/${id}/thumb_blur.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await adminClient.storage
    .from("dating-photos")
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[POST /api/admin/dating/[id]/upload-thumb]", uploadError.message);
    return NextResponse.json({ error: "업로드에 실패했습니다." }, { status: 500 });
  }

  // Update thumb_blur_path
  const { error: updateError } = await adminClient
    .from("dating_applications")
    .update({ thumb_blur_path: storagePath })
    .eq("id", id);

  if (updateError) {
    console.error("[POST /api/admin/dating/[id]/upload-thumb] update", updateError.message);
    return NextResponse.json({ error: "정보 업데이트에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path: storagePath });
}
