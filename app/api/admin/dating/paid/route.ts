import { isAdminEmail } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function parseAdminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isAllowedAdmin(userId: string, email?: string | null) {
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) {
    return allowlist.includes(userId);
  }
  return isAdminEmail(email);
}

async function createSignedUrl(path: string) {
  const admin = createAdminClient();
  const primary = await admin.storage.from("dating-card-photos").createSignedUrl(path, 3600);
  if (!primary.error && primary.data?.signedUrl) return primary.data.signedUrl;

  const legacy = await admin.storage.from("dating-photos").createSignedUrl(path, 3600);
  if (!legacy.error && legacy.data?.signedUrl) return legacy.data.signedUrl;

  return "";
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[admin-dating-paid-list] ${requestId} start`);

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError) {
      console.error(`[admin-dating-paid-list] ${requestId} auth error`, authError);
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!user) {
      return json(401, { ok: false, code: "UNAUTHORIZED", requestId, message: "로그인이 필요합니다." });
    }
    if (!isAllowedAdmin(user.id, user.email)) {
      return json(403, { ok: false, code: "FORBIDDEN", requestId, message: "권한이 없습니다." });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const nowIso = new Date().toISOString();

    const admin = createAdminClient();
    const expireRes = await admin
      .from("dating_paid_cards")
      .update({ status: "expired" })
      .eq("status", "approved")
      .lte("expires_at", nowIso);
    if (expireRes.error) {
      console.error(`[admin-dating-paid-list] ${requestId} expire update error`, expireRes.error);
    }

    let query = admin
      .from("dating_paid_cards")
      .select(
        "id,user_id,nickname,gender,age,region,height_cm,job,training_years,strengths_text,ideal_text,intro_text,instagram_id,photo_visibility,blur_thumb_path,photo_paths,status,paid_at,expires_at,created_at"
      )
      .order("created_at", { ascending: false });

    if (status === "pending" || status === "approved" || status === "rejected" || status === "expired") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      console.error(`[admin-dating-paid-list] ${requestId} query error`, error);
      return json(500, { ok: false, code: "LIST_FAILED", requestId, message: "유료 신청 목록을 불러오지 못했습니다." });
    }

    const items = await Promise.all(
      (data ?? []).map(async (row) => {
        const firstPath =
          Array.isArray(row.photo_paths) && row.photo_paths.length > 0 && typeof row.photo_paths[0] === "string"
            ? row.photo_paths[0]
            : "";

        let previewUrl = "";
        if (row.photo_visibility === "public" && firstPath) {
          previewUrl = await createSignedUrl(firstPath);
        } else if (row.blur_thumb_path) {
          previewUrl = await createSignedUrl(row.blur_thumb_path);
        } else if (firstPath) {
          previewUrl = await createSignedUrl(firstPath);
        }

        return {
          id: row.id,
          user_id: row.user_id,
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
          instagram_id: row.instagram_id,
          status: row.status,
          paid_at: row.paid_at,
          expires_at: row.expires_at,
          created_at: row.created_at,
          previewUrl,
        };
      })
    );

    return json(200, { ok: true, requestId, items });
  } catch (error) {
    console.error(`[admin-dating-paid-list] ${requestId} unhandled`, error);
    return json(500, { ok: false, code: "INTERNAL_SERVER_ERROR", requestId, message: "서버 오류가 발생했습니다." });
  }
}
