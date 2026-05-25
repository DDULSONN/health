import { ensureCronAuthorized } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const BUCKET = "dating-apply-photos";
const ROOT_PREFIX = "card-applications";
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DELETE_PER_RUN = 500;

function parseTimestampFromPath(path: string): number | null {
  const fileName = path.split("/").pop() ?? "";
  const match = /^(\d{12,})-\d+\.(?:jpe?g|png|webp)$/i.exec(fileName);
  if (!match) return null;
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function collectExpiredPaths(
  admin: ReturnType<typeof createAdminClient>,
  prefix: string,
  cutoffMs: number,
  output: string[]
) {
  if (output.length >= MAX_DELETE_PER_RUN) return;

  const { data, error } = await admin.storage.from(BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) {
    throw error;
  }

  for (const item of data ?? []) {
    if (output.length >= MAX_DELETE_PER_RUN) break;
    const path = `${prefix}/${item.name}`;
    const timestamp = parseTimestampFromPath(path);
    if (timestamp != null) {
      if (timestamp < cutoffMs) output.push(path);
      continue;
    }
    if (path.split("/").length >= 4) continue;
    await collectExpiredPaths(admin, path, cutoffMs, output);
  }
}

export async function GET(request: Request) {
  const authError = ensureCronAuthorized(request);
  if (authError) return authError;

  const admin = createAdminClient();
  const cutoffMs = Date.now() - RETENTION_MS;
  const expiredPaths: string[] = [];

  try {
    await collectExpiredPaths(admin, ROOT_PREFIX, cutoffMs, expiredPaths);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron dating-apply-photos-cleanup] list failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (expiredPaths.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  const removeRes = await admin.storage.from(BUCKET).remove(expiredPaths);
  if (removeRes.error) {
    console.error("[cron dating-apply-photos-cleanup] remove failed", removeRes.error.message);
    return NextResponse.json({ ok: false, error: removeRes.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: expiredPaths.length });
}
