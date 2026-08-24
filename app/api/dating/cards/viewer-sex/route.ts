import {
  cacheDatingViewerSexResolution,
  resolveDatingViewerSex,
  normalizeDatingSex,
  getOppositeDatingSex,
} from "@/lib/dating-viewer-sex";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { sex?: unknown } | null;
  const requestedSex = normalizeDatingSex(body?.sex);
  if (!requestedSex) {
    return NextResponse.json({ error: "성별을 확인해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const current = await resolveDatingViewerSex(admin, user);

  if (current.status === "unavailable") {
    return NextResponse.json({ error: "성별 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 503 });
  }
  if (current.status === "conflict") {
    return NextResponse.json(
      { code: "DATING_SEX_CONFLICT", error: "기존 오픈카드와 1:1 카드의 성별 정보가 일치하지 않습니다. 고객센터에 문의해주세요." },
      { status: 409 }
    );
  }
  if (current.source === "open_card" || current.source === "one_on_one") {
    if (current.viewerSex !== requestedSex) {
      return NextResponse.json(
        { code: "DATING_SEX_LOCKED", error: "기존 카드에 등록된 성별과 다르게 변경할 수 없습니다." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, locked: true, ...current });
  }

  const metadata = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const updateResult = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...metadata,
      dating_sex: requestedSex,
    },
  });

  if (updateResult.error) {
    console.error("[POST /api/dating/cards/viewer-sex] metadata update failed", {
      userId: user.id,
      code: updateResult.error.code ?? null,
    });
    return NextResponse.json({ error: "성별 정보를 저장하지 못했습니다." }, { status: 500 });
  }

  const updatedResolution = {
    status: "resolved" as const,
    viewerSex: requestedSex,
    targetSex: getOppositeDatingSex(requestedSex),
    source: "metadata" as const,
  };
  cacheDatingViewerSexResolution(user.id, updatedResolution);

  return NextResponse.json({ ok: true, locked: false, ...updatedResolution });
}
