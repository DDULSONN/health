import { createClient } from "@/lib/supabase/server";

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().includes(email.toLowerCase());
}

export async function getServerUserAndAdminStatus() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    user,
    isAdmin: isAdminEmail(user?.email),
  };
}

