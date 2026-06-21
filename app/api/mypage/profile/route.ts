import { NextResponse } from "next/server";
import { normalizeNickname, validateNickname } from "@/lib/nickname";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

function isDuplicateNicknameError(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return code === "23505" || message.includes("duplicate") || message.includes("unique");
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const profileRes = await admin
    .from("profiles")
    .select("nickname, nickname_changed_count, nickname_change_credits")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileRes.error) {
    console.error("[GET /api/mypage/profile] failed", profileRes.error);
    return NextResponse.json({ error: "프로필 정보를 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    profile: {
      nickname: profileRes.data?.nickname ?? null,
      nickname_changed_count: Number(profileRes.data?.nickname_changed_count ?? 0),
      nickname_change_credits: Number(profileRes.data?.nickname_change_credits ?? 0),
    },
  });
}

export async function PATCH(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { nickname?: string } | null;
  const nickname = normalizeNickname(String(body?.nickname ?? ""));
  const validationMessage = validateNickname(nickname);
  if (validationMessage) {
    return NextResponse.json({ error: validationMessage }, { status: 400 });
  }

  const admin = createAdminClient();
  const currentRes = await admin
    .from("profiles")
    .select("user_id,nickname")
    .eq("user_id", user.id)
    .maybeSingle();

  if (currentRes.error) {
    console.error("[PATCH /api/mypage/profile] current profile failed", currentRes.error);
    return NextResponse.json({ error: "프로필 정보를 확인하지 못했습니다." }, { status: 500 });
  }

  const currentNickname = String(currentRes.data?.nickname ?? "").trim();
  if (currentNickname.toLowerCase() === nickname.toLowerCase()) {
    return NextResponse.json({
      ok: true,
      profile: {
        nickname,
        previous_nickname: currentNickname || null,
        unchanged: true,
      },
    });
  }

  const duplicateRes = await admin
    .from("profiles")
    .select("user_id")
    .ilike("nickname", nickname)
    .neq("user_id", user.id)
    .limit(1);

  if (duplicateRes.error) {
    console.error("[PATCH /api/mypage/profile] duplicate check failed", duplicateRes.error);
    return NextResponse.json({ error: "닉네임 중복 확인에 실패했습니다." }, { status: 500 });
  }
  if ((duplicateRes.data ?? []).length > 0) {
    return NextResponse.json({ error: "이미 사용 중인 닉네임입니다." }, { status: 409 });
  }

  const updateResult = currentRes.data?.user_id
    ? await admin.from("profiles").update({ nickname }).eq("user_id", user.id)
    : await admin.from("profiles").upsert({ user_id: user.id, nickname }, { onConflict: "user_id" });

  if (updateResult.error) {
    console.error("[PATCH /api/mypage/profile] update failed", updateResult.error);
    return NextResponse.json(
      { error: isDuplicateNicknameError(updateResult.error) ? "이미 사용 중인 닉네임입니다." : "닉네임 변경에 실패했습니다." },
      { status: isDuplicateNicknameError(updateResult.error) ? 409 : 500 }
    );
  }

  const metadata = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  await admin.auth.admin
    .updateUserById(user.id, {
      user_metadata: {
        ...metadata,
        nickname,
        name: nickname,
      },
    })
    .catch((error) => {
      console.warn("[PATCH /api/mypage/profile] auth metadata update failed", error);
    });

  return NextResponse.json({
    ok: true,
    profile: {
      nickname,
      previous_nickname: currentNickname || null,
    },
  });
}
