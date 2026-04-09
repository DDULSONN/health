import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

const METADATA_KEY = "dating_adult_confirmed_at";

function readConfirmationValue(user: { user_metadata?: unknown } | null) {
  const metadata = user?.user_metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[METADATA_KEY];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({
      authenticated: false,
      confirmed: false,
      confirmed_at: null,
    });
  }

  const confirmedAt = readConfirmationValue(user);

  return NextResponse.json({
    authenticated: true,
    confirmed: Boolean(confirmedAt),
    confirmed_at: confirmedAt,
  });
}

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const confirmedAt = new Date().toISOString();
  const userMetadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};

  const admin = createAdminClient();
  const updateRes = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...userMetadata,
      [METADATA_KEY]: confirmedAt,
    },
  });

  if (updateRes.error) {
    console.error("[POST /api/mypage/dating-adult-confirmation] failed", updateRes.error);
    return NextResponse.json({ error: "성인 확인 상태 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    confirmed: true,
    confirmed_at: confirmedAt,
  });
}
