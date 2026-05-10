import {
  type DatingContactBlockItem,
  type DatingContactBlockType,
  hashDatingContactBlockValue,
  isMissingDatingContactBlocksTableError,
  maskDatingContactBlockValue,
  normalizeDatingContactBlockInput,
} from "@/lib/dating-contact-blocks";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type BlockPayload = {
  block_type?: unknown;
  value?: unknown;
  label?: unknown;
};

type DeletePayload = {
  id?: unknown;
};

function normalizeBlockType(raw: unknown): DatingContactBlockType | null {
  return raw === "phone" || raw === "instagram" ? raw : null;
}

function normalizeLabel(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("dating_contact_blocks")
    .select("id,block_type,value_hint,label,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (isMissingDatingContactBlocksTableError(error)) {
      return NextResponse.json({ items: [], schema_missing: true });
    }
    console.error("[GET /api/dating/contact-blocks] failed", error);
    return NextResponse.json({ error: "오픈카드 지인 차단 목록을 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []) as DatingContactBlockItem[] });
}

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as BlockPayload | null;
  const blockType = normalizeBlockType(body?.block_type);
  if (!blockType) {
    return NextResponse.json({ error: "차단 방식이 올바르지 않습니다." }, { status: 400 });
  }

  const normalizedValue = normalizeDatingContactBlockInput(blockType, String(body?.value ?? ""));
  if (!normalizedValue) {
    const message =
      blockType === "phone"
        ? "휴대폰 번호는 01012345678 형식으로 입력해주세요."
        : "인스타 아이디는 @ 없이 영문, 숫자, 점, 밑줄만 입력해주세요.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = createAdminClient();
  const valueHash = hashDatingContactBlockValue(blockType, normalizedValue);
  const upsertRes = await admin
    .from("dating_contact_blocks")
    .upsert(
      {
        user_id: user.id,
        block_type: blockType,
        value_hash: valueHash,
        value_hint: maskDatingContactBlockValue(blockType, normalizedValue),
        label: normalizeLabel(body?.label),
      },
      { onConflict: "user_id,block_type,value_hash" }
    )
    .select("id,block_type,value_hint,label,created_at")
    .maybeSingle();

  if (upsertRes.error) {
    console.error("[POST /api/dating/contact-blocks] failed", upsertRes.error);
    const message = isMissingDatingContactBlocksTableError(upsertRes.error)
      ? "오픈카드 지인 차단 테이블이 아직 적용되지 않았습니다. 관리자에게 문의해주세요."
      : "오픈카드 지인 차단 저장에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: upsertRes.data as DatingContactBlockItem | null });
}

export async function DELETE(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as DeletePayload | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "삭제할 차단 항목을 찾지 못했습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("dating_contact_blocks").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    console.error("[DELETE /api/dating/contact-blocks] failed", error);
    return NextResponse.json({ error: "오픈카드 지인 차단 삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id });
}
