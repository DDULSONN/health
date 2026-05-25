import { isAllowedAdminUser } from "@/lib/admin";
import { extractStorageObjectPathFromBuckets } from "@/lib/images";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const APPLY_PHOTO_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function normalizePath(raw: unknown): string {
  const path = extractStorageObjectPathFromBuckets(raw, ["dating-apply-photos", "dating-photos"]) ?? "";
  return path.trim().replace(/^\/+/, "");
}

function getApplyPhotoTimestamp(path: string): number | null {
  const fileName = path.split("/").pop() ?? "";
  const match = /^(\d{12,})-\d+\.(?:jpe?g|png|webp)$/i.exec(fileName);
  if (!match) return null;
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user || !isAllowedAdminUser(user.id, user.email)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const path = normalizePath(searchParams.get("path"));
  if (!path || !path.startsWith("card-applications/")) {
    return new Response("Bad Request", { status: 400 });
  }
  const timestamp = getApplyPhotoTimestamp(path);
  if (timestamp == null || Date.now() - timestamp > APPLY_PHOTO_RETENTION_MS) {
    return new Response("Gone", { status: 410 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from("dating-apply-photos").download(path);
  if (error || !data) {
    console.error("[GET /api/admin/dating/cards/application-photo] download failed", {
      pathTail: path.split("/").slice(-3).join("/"),
      message: error?.message ?? null,
    });
    return new Response("Not Found", { status: 404 });
  }

  const headers = new Headers();
  headers.set("Content-Type", data.type || "image/webp");
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return new NextResponse(data.stream(), { status: 200, headers });
}
