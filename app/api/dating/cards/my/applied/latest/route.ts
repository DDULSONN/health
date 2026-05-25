import { NextResponse } from "next/server";

import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";

type LatestApplicationRow = {
  id: string;
  age: number | null;
  height_cm: number | null;
  region: string | null;
  job: string | null;
  training_years: number | null;
  intro_text: string | null;
  instagram_id: string | null;
  photo_paths: unknown[] | null;
  created_at: string;
};

const APPLY_PHOTO_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function getApplyPhotoTimestamp(path: string): number | null {
  const fileName = path.split("/").pop() ?? "";
  const match = /^(\d{12,})-\d+\.(?:jpe?g|png|webp)$/i.exec(fileName);
  if (!match) return null;
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isFreshApplyPhotoPath(path: string): boolean {
  const timestamp = getApplyPhotoTimestamp(path);
  return timestamp != null && Date.now() - timestamp <= APPLY_PHOTO_RETENTION_MS;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const latestRes = await adminClient
    .from("dating_card_applications")
    .select("id, age, height_cm, region, job, training_years, intro_text, instagram_id, photo_paths, created_at")
    .eq("applicant_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestRes.error) {
    console.error("[GET /api/dating/cards/my/applied/latest] failed", latestRes.error);
    return NextResponse.json({ error: "마지막 지원 내역을 불러오지 못했습니다." }, { status: 500 });
  }

  const latest = (latestRes.data ?? null) as LatestApplicationRow | null;
  if (!latest) {
    return NextResponse.json({ item: null });
  }

  const photoPaths = Array.isArray(latest.photo_paths)
    ? latest.photo_paths.filter((item): item is string => typeof item === "string" && isFreshApplyPhotoPath(item))
    : [];

  return NextResponse.json({
    item: {
      id: latest.id,
      age: latest.age,
      height_cm: latest.height_cm,
      region: latest.region ?? "",
      job: latest.job ?? "",
      training_years: latest.training_years,
      intro_text: latest.intro_text ?? "",
      instagram_id: latest.instagram_id ?? "",
      photo_paths: photoPaths,
      created_at: latest.created_at,
    },
  });
}
