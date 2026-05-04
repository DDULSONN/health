import { NextResponse } from "next/server";
import {
  createAdminPanelUnlockToken,
  getAdminPanelCookieMaxAge,
  getAdminPanelCookieName,
  verifyAdminPanelPassword,
} from "@/lib/admin-panel-lock";
import { requireAdminRoute } from "@/lib/admin-route";

export async function POST(request: Request) {
  const adminGuard = await requireAdminRoute();
  if (!adminGuard.ok) return adminGuard.response;

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!verifyAdminPanelPassword(password)) {
    return NextResponse.json({ ok: false, message: "비밀번호가 맞지 않습니다." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getAdminPanelCookieName(), await createAdminPanelUnlockToken(adminGuard.user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: getAdminPanelCookieMaxAge(),
  });
  return response;
}
