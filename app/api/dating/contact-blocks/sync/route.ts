import {
  hashOneOnOneBlockedPhone,
  isMissingPhoneBlocksTableError,
  maskBlockedPhone,
  normalizePhoneForOneOnOneBlock,
} from "@/lib/dating-1on1-phone-blocks";
import {
  hashDatingContactBlockValue,
  isMissingDatingContactBlocksTableError,
  maskDatingContactBlockValue,
  normalizeDatingContactPhone,
} from "@/lib/dating-contact-blocks";
import { ensureAllowedMutationOrigin } from "@/lib/request-origin";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { NextResponse } from "next/server";

const MAX_RAW_PHONE_COUNT = 10_000;
const MAX_SYNC_PHONE_COUNT = 5_000;
const UPSERT_BATCH_SIZE = 500;

type SyncPayload = {
  phones?: unknown;
};

function normalizePhones(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_RAW_PHONE_COUNT) return null;

  const phones = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const phone = normalizeDatingContactPhone(raw);
    if (!phone) continue;
    phones.add(phone);
    if (phones.size > MAX_SYNC_PHONE_COUNT) return null;
  }
  return [...phones];
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const [countRes, latestRes] = await Promise.all([
    admin
      .from("dating_contact_blocks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("block_type", "phone"),
    admin
      .from("dating_contact_blocks")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("block_type", "phone")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (countRes.error || latestRes.error) {
    const error = countRes.error ?? latestRes.error;
    if (isMissingDatingContactBlocksTableError(error)) {
      return NextResponse.json({ count: 0, last_synced_at: null, schema_missing: true });
    }
    console.error("[GET /api/dating/contact-blocks/sync] failed", error);
    return NextResponse.json({ error: "연락처 차단 상태를 불러오지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    count: countRes.count ?? 0,
    last_synced_at: latestRes.data?.created_at ?? null,
  });
}

export async function POST(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as SyncPayload | null;
  const phones = normalizePhones(body?.phones);
  if (!phones) {
    return NextResponse.json(
      { error: `연락처는 한 번에 최대 ${MAX_SYNC_PHONE_COUNT.toLocaleString("ko-KR")}개까지 등록할 수 있습니다.` },
      { status: 400 }
    );
  }
  if (phones.length === 0) {
    return NextResponse.json({ ok: true, imported_count: 0, total_count: 0 });
  }

  const admin = createAdminClient();
  for (let start = 0; start < phones.length; start += UPSERT_BATCH_SIZE) {
    const chunk = phones.slice(start, start + UPSERT_BATCH_SIZE);
    const datingRows = chunk.map((phone) => ({
      user_id: user.id,
      block_type: "phone",
      value_hash: hashDatingContactBlockValue("phone", phone),
      value_hint: maskDatingContactBlockValue("phone", phone),
      label: "연락처 동기화",
    }));
    const oneOnOneRows = chunk.map((phone) => ({
      user_id: user.id,
      phone_hash: hashOneOnOneBlockedPhone(normalizePhoneForOneOnOneBlock(phone)),
      phone_last4: maskBlockedPhone(phone),
      label: "연락처 동기화",
    }));

    const datingRes = await admin
      .from("dating_contact_blocks")
      .upsert(datingRows, { onConflict: "user_id,block_type,value_hash", ignoreDuplicates: true });
    if (datingRes.error) {
      console.error("[POST /api/dating/contact-blocks/sync] dating upsert failed", datingRes.error);
      const message = isMissingDatingContactBlocksTableError(datingRes.error)
        ? "지인 차단 기능이 아직 서버에 적용되지 않았습니다."
        : "연락처 차단 등록에 실패했습니다.";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const oneOnOneRes = await admin
      .from("dating_1on1_phone_blocks")
      .upsert(oneOnOneRows, { onConflict: "user_id,phone_hash", ignoreDuplicates: true });
    if (oneOnOneRes.error) {
      console.error("[POST /api/dating/contact-blocks/sync] 1on1 upsert failed", oneOnOneRes.error);
      const message = isMissingPhoneBlocksTableError(oneOnOneRes.error)
        ? "1:1 지인 차단 기능이 아직 서버에 적용되지 않았습니다."
        : "1:1 연락처 차단 등록에 실패했습니다.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const countRes = await admin
    .from("dating_contact_blocks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("block_type", "phone");

  return NextResponse.json({
    ok: true,
    imported_count: phones.length,
    total_count: countRes.count ?? phones.length,
  });
}

export async function DELETE(req: Request) {
  const originError = ensureAllowedMutationOrigin(req);
  if (originError) return originError;

  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const [datingRes, oneOnOneRes] = await Promise.all([
    admin.from("dating_contact_blocks").delete().eq("user_id", user.id).eq("block_type", "phone"),
    admin.from("dating_1on1_phone_blocks").delete().eq("user_id", user.id),
  ]);

  if (datingRes.error || oneOnOneRes.error) {
    console.error("[DELETE /api/dating/contact-blocks/sync] failed", datingRes.error ?? oneOnOneRes.error);
    return NextResponse.json({ error: "휴대폰 번호 차단 전체 삭제에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
