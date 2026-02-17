import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const CARD_BUCKET = "dating-card-photos";

async function ensureCardBucket(adminClient: ReturnType<typeof createAdminClient>) {
  const { error } = await adminClient.storage.createBucket(CARD_BUCKET, {
    public: false,
    fileSizeLimit: `${MAX_FILE_SIZE}`,
    allowedMimeTypes: ALLOWED_TYPES,
  });

  if (!error) return;

  const message = (error.message ?? "").toLowerCase();
  const alreadyExists = message.includes("already") || message.includes("duplicate");
  if (!alreadyExists) {
    throw error;
  }
}

async function uploadCardPhoto(
  adminClient: ReturnType<typeof createAdminClient>,
  path: string,
  file: File
) {
  const firstTry = await adminClient.storage.from(CARD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
    cacheControl: "3600",
  });

  if (!firstTry.error) return { error: null as null | { message?: string } };

  const message = (firstTry.error.message ?? "").toLowerCase();
  const bucketMissing = message.includes("bucket") && message.includes("not");
  if (!bucketMissing) return { error: firstTry.error };

  await ensureCardBucket(adminClient);

  const secondTry = await adminClient.storage.from(CARD_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
    cacheControl: "3600",
  });

  return { error: secondTry.error };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "서버 설정 오류입니다. 관리자에게 문의해주세요. (SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 }
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const file = form.get("file");
  const kind = String(form.get("kind") ?? "raw");
  const index = Number(String(form.get("index") ?? "0"));

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "JPG/PNG/WebP 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "파일은 5MB 이하만 가능합니다." }, { status: 400 });
  }

  if (index < 0 || index > 9) {
    return NextResponse.json({ error: "index 값이 올바르지 않습니다." }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const folder = kind === "blur" ? "blur" : "raw";
  const path = `cards/${user.id}/${folder}/${Date.now()}-${index}.${ext}`;

  try {
    const adminClient = createAdminClient();
    const { error } = await uploadCardPhoto(adminClient, path, file);

    if (error) {
      console.error("[POST /api/dating/cards/upload-card] failed", error);
      return NextResponse.json(
        { error: `카드 사진 업로드에 실패했습니다. ${error.message ?? "잠시 후 다시 시도해주세요."}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ path }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/dating/cards/upload-card] exception", error);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return NextResponse.json({ error: `카드 사진 업로드에 실패했습니다. ${message}` }, { status: 500 });
  }
}