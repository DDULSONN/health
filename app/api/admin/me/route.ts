import { NextResponse } from "next/server";
import { getRequestAuthContext } from "@/lib/supabase/request";
import { isAllowedAdminUser } from "@/lib/admin";

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);

  if (!user) {
    return NextResponse.json({ isAdmin: false });
  }

  return NextResponse.json({
    isAdmin: isAllowedAdminUser(user.id, user.email),
  });
}
