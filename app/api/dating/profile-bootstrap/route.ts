import { NextResponse } from "next/server";
import { isAllowedAdminUser } from "@/lib/admin";
import { countCumulativeOneOnOneApplicants } from "@/lib/dating-1on1-metrics";
import { getDatingOneOnOneWriteStatus } from "@/lib/dating-1on1";
import { recoverOpenCardRepostEntitlement } from "@/lib/open-card-repost";
import { resolveDatingViewerSex } from "@/lib/dating-viewer-sex";
import { createAdminClient } from "@/lib/supabase/server";
import { getRequestAuthContext } from "@/lib/supabase/request";

function settingEnabled(value: unknown) {
  if (!value || typeof value !== "object") return true;
  return (value as { enabled?: unknown }).enabled !== false;
}

function isMissingBoostTable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes("dating_open_card_first_queue_boosts");
}

export async function GET(req: Request) {
  const { user } = await getRequestAuthContext(req);
  if (!user) {
    return NextResponse.json(
      { error: "로그인이 필요합니다." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const admin = createAdminClient();
  const isAdmin = isAllowedAdminUser(user.id, user.email);
  await recoverOpenCardRepostEntitlement(admin, user.id).catch((error) => {
    console.error("[dating/profile-bootstrap] paid repost recovery failed", error);
  });

  try {
    const loadProfile = async () => {
      let result = await admin
        .from("profiles")
        .select("nickname,phone_verified,swipe_profile_visible")
        .eq("user_id", user.id)
        .maybeSingle();

      if (result.error?.message?.includes("swipe_profile_visible")) {
        result = await admin
          .from("profiles")
          .select("nickname,phone_verified")
          .eq("user_id", user.id)
          .maybeSingle();
      }

      return result;
    };

    const [profileRes, openCardsRes, activeOneOnOneRes, openWriteRes, boostRes, oneOnOneWriteStatus, totalApplications, viewerSexResolution] = await Promise.all([
      loadProfile(),
      admin
        .from("dating_cards")
        .select("id,status,display_nickname,created_at")
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: false }),
      admin
        .from("dating_1on1_cards")
        .select("status")
        .eq("user_id", user.id)
        .in("status", ["submitted", "reviewing", "approved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("site_settings").select("value_json").eq("key", "open_card_write_enabled").maybeSingle(),
      admin.from("dating_open_card_first_queue_boosts").select("user_id").eq("user_id", user.id).maybeSingle(),
      getDatingOneOnOneWriteStatus(admin),
      countCumulativeOneOnOneApplicants(admin).catch((error) => {
        console.error("[dating/profile-bootstrap] cumulative count failed", error);
        return 0;
      }),
      isAdmin ? Promise.resolve(null) : resolveDatingViewerSex(admin, user),
    ]);

    const requiredError = profileRes.error || openCardsRes.error || activeOneOnOneRes.error;
    if (requiredError) {
      console.error("[dating/profile-bootstrap] required state failed", requiredError.message);
      return NextResponse.json(
        { error: "프로필 상태를 불러오지 못했습니다." },
        { status: 500, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    if (openWriteRes.error) {
      console.error("[dating/profile-bootstrap] open-card write setting failed", openWriteRes.error.message);
    }

    if (boostRes.error && !isMissingBoostTable(boostRes.error)) {
      console.error("[dating/profile-bootstrap] boost status failed", boostRes.error.message);
    }

    const openCards = openCardsRes.data ?? [];
    const firstQueueBoostUsed = Boolean(boostRes.data);
    const canShowFirstQueueBoost = !firstQueueBoostUsed && openCards.length === 1;
    const activeRequestStatus = typeof activeOneOnOneRes.data?.status === "string"
      ? activeOneOnOneRes.data.status
      : null;
    const phoneVerified = profileRes.data?.phone_verified === true;
    const canWriteOneOnOne = phoneVerified && oneOnOneWriteStatus === "approved" && !activeRequestStatus;
    const audience = isAdmin
      ? {
          status: "admin" as const,
          viewerSex: null,
          targetSex: "female" as const,
          source: null,
          canSwitchSex: true,
          requiresSexSelection: false,
        }
      : {
          ...viewerSexResolution!,
          canSwitchSex: false,
          requiresSexSelection: viewerSexResolution!.status === "missing",
        };

    return NextResponse.json(
      {
        profile: {
          profile: {
            nickname: profileRes.data?.nickname ?? null,
            phone_verified: phoneVerified,
            swipe_profile_visible: profileRes.data?.swipe_profile_visible !== false,
          },
          isAdmin,
        },
        openCards: {
          items: openCards.map((card) => ({
            ...card,
            can_first_queue_boost: canShowFirstQueueBoost && card.status === "pending",
            first_queue_boost_used: firstQueueBoostUsed,
          })),
          first_queue_boost_used: firstQueueBoostUsed,
        },
        oneOnOne: {
          loggedIn: true,
          isAdmin,
          phoneVerified,
          writeStatus: oneOnOneWriteStatus,
          canWrite: canWriteOneOnOne,
          activeRequestStatus,
          totalApplications,
          reason: canWriteOneOnOne
            ? null
            : !phoneVerified
              ? "PHONE_NOT_VERIFIED"
              : activeRequestStatus
                ? "ACTIVE_REQUEST_EXISTS"
                : "WRITE_PAUSED",
        },
        openWrite: { enabled: openWriteRes.error ? true : settingEnabled(openWriteRes.data?.value_json) },
        audience,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[dating/profile-bootstrap] unexpected failure", error);
    return NextResponse.json(
      { error: "프로필 상태를 불러오지 못했습니다." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
