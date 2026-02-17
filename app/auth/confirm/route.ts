import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const incoming = new URL(request.url);
  const target = new URL("/auth/callback", incoming.origin);

  incoming.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  return NextResponse.redirect(target);
}