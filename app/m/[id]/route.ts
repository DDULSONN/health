import { NextResponse } from "next/server";
import { normalizeOneOnOneMatchId, oneOnOneMatchHref } from "@/lib/dating-1on1-match-navigation";
// Public navigation only; viewing the linked match still requires the recipient's login.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = normalizeOneOnOneMatchId((await params).id);
  return NextResponse.redirect(new URL(oneOnOneMatchHref(id), new URL(request.url).origin), 307);
}
