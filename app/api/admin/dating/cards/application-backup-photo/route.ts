import { isAllowedAdminUser } from "@/lib/admin";
import { hashAdminAuditValue, recordAdminAuditEvent } from "@/lib/admin-audit";
import { extractStorageObjectPathFromBuckets } from "@/lib/images";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const BUCKET = "dating-apply-photos";
const BACKUP_PREFIX = "admin-application-backups/";
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function normalizePath(raw: unknown): string {
  const path = extractStorageObjectPathFromBuckets(raw, [BUCKET]) ?? "";
  return path.trim().replace(/^\/+/, "");
}

function timestampFromBackupPath(path: string): number | null {
  const fileName = path.split("/").pop() ?? "";
  const match = /^(\d{12,})-\d+\.webp$/i.exec(fileName);
  if (!match) return null;
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function GET(req: Request) {
  const requestId = crypto.randomUUID();
  const { user } = await getRequestAuthContext(req);
  if (!user || !isAllowedAdminUser(user.id, user.email)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const path = normalizePath(searchParams.get("path"));
  if (!path || !path.startsWith(BACKUP_PREFIX)) {
    return new Response("Bad Request", { status: 400 });
  }

  const timestamp = timestampFromBackupPath(path);
  if (timestamp == null || Date.now() - timestamp > RETENTION_MS) {
    return new Response("Gone", { status: 410 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) {
    console.error("[GET /api/admin/dating/cards/application-backup-photo] download failed", {
      pathTail: path.split("/").slice(-3).join("/"),
      message: error?.message ?? null,
    });
    await recordAdminAuditEvent({
      admin,
      adminUser: user,
      request: req,
      action: "application_backup_photo_view",
      targetType: "dating_apply_photo_backup",
      targetId: hashAdminAuditValue(path),
      requestId,
      status: "failure",
      metadata: { path_tail: path.split("/").slice(-3).join("/"), message: error?.message ?? null },
    });
    return new Response("Not Found", { status: 404 });
  }

  await recordAdminAuditEvent({
    admin,
    adminUser: user,
    request: req,
    action: "application_backup_photo_view",
    targetType: "dating_apply_photo_backup",
    targetId: hashAdminAuditValue(path),
    requestId,
    metadata: { path_tail: path.split("/").slice(-3).join("/"), age_ms: Date.now() - (timestamp ?? Date.now()) },
  });

  const headers = new Headers();
  headers.set("Content-Type", "image/webp");
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return new NextResponse(data.stream(), { status: 200, headers });
}
