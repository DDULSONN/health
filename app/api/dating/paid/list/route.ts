import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

async function createSignedUrl(path: string) {
  const admin = createAdminClient();
  const primary = await admin.storage.from("dating-card-photos").createSignedUrl(path, 3600);
  if (!primary.error && primary.data?.signedUrl) return primary.data.signedUrl;

  const legacy = await admin.storage.from("dating-photos").createSignedUrl(path, 3600);
  if (!legacy.error && legacy.data?.signedUrl) return legacy.data.signedUrl;

  return "";
}

export async function GET() {
  const requestId = crypto.randomUUID();
  console.log(`[dating-paid-list] ${requestId} start`);

  try {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    // Opportunistic expiration so stale approved cards are 내려감 even without cron timing drift.
    const expireRes = await admin
      .from("dating_paid_cards")
      .update({ status: "expired" })
      .eq("status", "approved")
      .lte("expires_at", nowIso);
    if (expireRes.error) {
      console.error(`[dating-paid-list] ${requestId} expire update error`, expireRes.error);
    }

    const { data, error } = await admin
      .from("dating_paid_cards")
      .select(
        "id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,photo_visibility,blur_thumb_path,photo_paths,expires_at,paid_at,created_at"
      )
      .eq("status", "approved")
      .gt("expires_at", nowIso)
      .order("paid_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (error) {
      console.error(`[dating-paid-list] ${requestId} query error`, error);
      return json(500, { ok: false, code: "LIST_FAILED", requestId, message: "목록을 불러오지 못했습니다." });
    }

    const items = await Promise.all(
      (data ?? []).map(async (row) => {
        const firstPath =
          Array.isArray(row.photo_paths) && row.photo_paths.length > 0 && typeof row.photo_paths[0] === "string"
            ? row.photo_paths[0]
            : "";

        let thumbUrl = "";
        if (row.photo_visibility === "public" && firstPath) {
          thumbUrl = await createSignedUrl(firstPath);
        } else if (row.blur_thumb_path) {
          thumbUrl = await createSignedUrl(row.blur_thumb_path);
        }

        return {
          id: row.id,
          nickname: row.nickname,
          gender: row.gender,
          age: row.age,
          region: row.region,
          height_cm: row.height_cm,
          job: row.job,
          training_years: row.training_years,
          strengths_text: row.strengths_text,
          ideal_text: row.ideal_text,
          intro_text: row.intro_text,
          thumbUrl,
          expires_at: row.expires_at,
          paid_at: row.paid_at,
        };
      })
    );

    return json(200, { ok: true, requestId, items });
  } catch (error) {
    console.error(`[dating-paid-list] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
