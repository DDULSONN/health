import {
  hashOneOnOneBlockedPhone,
  isMissingPhoneBlocksTableError,
  maskBlockedPhone,
  normalizePhoneForOneOnOneBlock,
} from "@/lib/dating-1on1-phone-blocks";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type PhoneBlockPayload = {
  phone?: string;
  label?: string;
};

type PhoneBlockDeletePayload = {
  id?: string;
};

type PhoneBlockItem = {
  id: string;
  phone_last4: string | null;
  label: string | null;
  created_at: string;
};

function normalizeLabel(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("dating_1on1_phone_blocks")
    .select("id,phone_last4,label,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (isMissingPhoneBlocksTableError(error)) {
      return NextResponse.json({ items: [], schema_missing: true });
    }
    console.error("[GET /api/dating/1on1/phone-blocks] failed", error);
    return NextResponse.json({ error: "차단 번호 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []) as PhoneBlockItem[] });
}

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as PhoneBlockPayload | null;
  const phoneE164 = normalizePhoneForOneOnOneBlock(String(body?.phone ?? ""));
  if (!phoneE164) {
    return NextResponse.json({ error: "차단할 휴대폰 번호를 01012345678 형식으로 입력해주세요." }, { status: 400 });
  }

  const admin = createAdminClient();
  const phoneHash = hashOneOnOneBlockedPhone(phoneE164);
  const upsertRes = await admin
    .from("dating_1on1_phone_blocks")
    .upsert(
      {
        user_id: user.id,
        phone_hash: phoneHash,
        phone_last4: maskBlockedPhone(phoneE164),
        label: normalizeLabel(body?.label),
      },
      { onConflict: "user_id,phone_hash" }
    )
    .select("id,phone_last4,label,created_at")
    .maybeSingle();

  if (upsertRes.error) {
    console.error("[POST /api/dating/1on1/phone-blocks] failed", upsertRes.error);
    const message = isMissingPhoneBlocksTableError(upsertRes.error)
      ? "차단 번호 저장 테이블이 아직 적용되지 않았습니다. 관리자에게 문의해주세요."
      : "차단 번호 저장에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: upsertRes.data as PhoneBlockItem | null });
}

export async function DELETE(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as PhoneBlockDeletePayload | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "삭제할 차단 항목을 찾지 못했습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("dating_1on1_phone_blocks").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    console.error("[DELETE /api/dating/1on1/phone-blocks] failed", error);
    return NextResponse.json({ error: "차단 번호 삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id });
}
