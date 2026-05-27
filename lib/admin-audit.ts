import crypto from "crypto";
import type { User } from "@supabase/supabase-js";
import { extractClientIp } from "@/lib/request-rate-limit";
import { createAdminClient } from "@/lib/supabase/server";

type AdminAuditStatus = "success" | "failure";

type AdminAuditInput = {
  admin?: ReturnType<typeof createAdminClient>;
  adminUser: Pick<User, "id" | "email">;
  request: Request;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  status?: AdminAuditStatus;
  metadata?: Record<string, unknown>;
};

function getAuditHashSecret() {
  return process.env.ADMIN_AUDIT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "local-admin-audit-secret";
}

export function hashAdminAuditValue(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  return crypto.createHmac("sha256", getAuditHashSecret()).update(normalized).digest("hex");
}

function sanitizeMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (typeof value === "string") return [key, value.slice(0, 500)];
      return [key, value];
    })
  );
}

export async function recordAdminAuditEvent(input: AdminAuditInput) {
  try {
    const admin = input.admin ?? createAdminClient();
    const ip = extractClientIp(input.request);
    const userAgent = input.request.headers.get("user-agent") ?? "";
    const res = await admin.from("admin_audit_logs").insert({
      admin_user_id: input.adminUser.id,
      admin_email: input.adminUser.email ?? null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      request_id: input.requestId ?? null,
      ip_hash: hashAdminAuditValue(ip),
      user_agent_hash: hashAdminAuditValue(userAgent),
      status: input.status ?? "success",
      metadata: sanitizeMetadata(input.metadata ?? {}),
    });
    if (res.error && res.error.code !== "42P01" && res.error.code !== "PGRST205") {
      console.warn("[admin-audit] insert failed", res.error.message);
    }
  } catch (error) {
    console.warn("[admin-audit] unavailable", error);
  }
}

