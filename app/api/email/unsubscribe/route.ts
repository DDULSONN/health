import { NextResponse } from "next/server";
import {
  verifyEmailUnsubscribeToken,
} from "@/lib/marketing-email";
import { createAdminClient } from "@/lib/supabase/server";

const VALID_CAMPAIGNS = new Set(["open_card_outreach", "one_on_one_outreach", "all"]);

function html(message: string, status = 200) {
  return new NextResponse(
    `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GymTools 메일 수신거부</title>
    <style>
      body { margin: 0; background: #f7f7f5; color: #171717; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      section { max-width: 420px; border: 1px solid #e5e5e5; border-radius: 24px; background: white; padding: 28px; box-shadow: 0 12px 30px rgba(0,0,0,.06); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0; line-height: 1.7; color: #525252; }
      a { display: inline-block; margin-top: 20px; color: #059669; font-weight: 700; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>메일 수신거부</h1>
        <p>${message}</p>
        <a href="https://helchang.com">GymTools로 돌아가기</a>
      </section>
    </main>
  </body>
</html>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}

function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("uid")?.trim() ?? "";
  const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
  const campaignKey = url.searchParams.get("campaign")?.trim() ?? "";
  const token = url.searchParams.get("token")?.trim() ?? "";

  if (!userId || !email || !VALID_CAMPAIGNS.has(campaignKey)) {
    return html("수신거부 링크가 올바르지 않습니다.", 400);
  }

  if (!verifyEmailUnsubscribeToken({ userId, email, campaignKey, token })) {
    return html("수신거부 링크가 만료되었거나 올바르지 않습니다.", 403);
  }

  const admin = createAdminClient();
  const res = await admin.from("email_marketing_unsubscribes").upsert(
    {
      user_id: userId,
      email,
      campaign_key: campaignKey,
      source: "email_link",
      user_agent: request.headers.get("user-agent") ?? null,
      ip_address: getClientIp(request),
      unsubscribed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,campaign_key" }
  );

  if (res.error) {
    console.error("[GET /api/email/unsubscribe] failed", res.error);
    return html("수신거부 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", 500);
  }

  return html("수신거부가 완료되었습니다. 앞으로 해당 안내 메일 발송 대상에서 제외됩니다.");
}
