import { createClient } from "@/lib/supabase/server";

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function parseAdminUserIds(): string[] {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().includes(email.toLowerCase());
}

export function isAllowedAdminUser(userId: string | null | undefined, email: string | null | undefined): boolean {
  if (!userId) return false;
  const allowlist = parseAdminUserIds();
  if (allowlist.length > 0) return allowlist.includes(userId);
  return isAdminEmail(email);
}

export async function getServerUserAndAdminStatus() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    user,
    isAdmin: isAllowedAdminUser(user?.id, user?.email),
  };
}
