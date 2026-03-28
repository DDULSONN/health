import { requireAdminRoute } from "@/lib/admin-route";
import { NextResponse } from "next/server";

const PAGE_SIZE = 1000;

type RegionRow = {
  region: string | null;
};

function normalizeRegion(value: string | null | undefined) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "미입력";
}

function topRegions(rows: RegionRow[], limit = 5) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const region = normalizeRegion(row.region);
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, limit)
    .map(([region, count]) => ({ region, count }));
}

async function fetchExactCount(query: PromiseLike<{ count: number | null; error: unknown }>) {
  const result = await query;
  if (result.error) throw result.error;
  return result.count ?? 0;
}

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const page = await fetchPage(from, to);
    if (page.error) throw page.error;
    const rows = page.data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}

export async function GET() {
  const requestId = crypto.randomUUID();
  const adminGuard = await requireAdminRoute();
  if (!adminGuard.ok) return adminGuard.response;

  try {
    const { admin } = adminGuard;
    const nowIso = new Date().toISOString();

    const [
      openTotal,
      openPending,
      openPublic,
      openHidden,
      openExpired,
      openMale,
      openFemale,
      openAppTotal,
      openAppSubmitted,
      openAppAccepted,
      openAppRejected,
      openAppCanceled,
      paidTotal,
      paidPending,
      paidApproved,
      paidRejected,
      paidExpired,
      paidBlur,
      paidPublic,
      paidAppTotal,
      paidAppSubmitted,
      paidAppAccepted,
      paidAppRejected,
      paidAppCanceled,
      oneOnOneTotal,
      oneOnOneSubmitted,
      oneOnOneReviewing,
      oneOnOneApproved,
      oneOnOneRejected,
      oneOnOneMale,
      oneOnOneFemale,
      oneOnOneMatchTotal,
      oneOnOneProposed,
      oneOnOneSourceSelected,
      oneOnOneCandidateAccepted,
      oneOnOneMutualAccepted,
      oneOnOneCandidateRejected,
      oneOnOneSourceDeclined,
      oneOnOneSourceSkipped,
      oneOnOneAdminCanceled,
      moreViewPending,
      moreViewApproved,
      moreViewRejected,
      moreViewActive,
      cityViewPending,
      cityViewApproved,
      cityViewRejected,
      cityViewActive,
      publicOpenRegionRows,
      approvedOneOnOneRegionRows,
    ] = await Promise.all([
      fetchExactCount(admin.from("dating_cards").select("id", { count: "exact", head: true })),
      fetchExactCount(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCount(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "public")),
      fetchExactCount(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "hidden")),
      fetchExactCount(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("status", "expired")),
      fetchExactCount(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("sex", "male")),
      fetchExactCount(admin.from("dating_cards").select("id", { count: "exact", head: true }).eq("sex", "female")),
      fetchExactCount(admin.from("dating_card_applications").select("id", { count: "exact", head: true })),
      fetchExactCount(admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("status", "submitted")),
      fetchExactCount(admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("status", "accepted")),
      fetchExactCount(admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("status", "rejected")),
      fetchExactCount(admin.from("dating_card_applications").select("id", { count: "exact", head: true }).eq("status", "canceled")),
      fetchExactCount(admin.from("dating_paid_cards").select("id", { count: "exact", head: true })),
      fetchExactCount(admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCount(admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCount(admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("status", "rejected")),
      fetchExactCount(admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("status", "expired")),
      fetchExactCount(admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("photo_visibility", "blur")),
      fetchExactCount(admin.from("dating_paid_cards").select("id", { count: "exact", head: true }).eq("photo_visibility", "public")),
      fetchExactCount(admin.from("dating_paid_card_applications").select("id", { count: "exact", head: true })),
      fetchExactCount(admin.from("dating_paid_card_applications").select("id", { count: "exact", head: true }).eq("status", "submitted")),
      fetchExactCount(admin.from("dating_paid_card_applications").select("id", { count: "exact", head: true }).eq("status", "accepted")),
      fetchExactCount(admin.from("dating_paid_card_applications").select("id", { count: "exact", head: true }).eq("status", "rejected")),
      fetchExactCount(admin.from("dating_paid_card_applications").select("id", { count: "exact", head: true }).eq("status", "canceled")),
      fetchExactCount(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true })),
      fetchExactCount(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("status", "submitted")),
      fetchExactCount(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("status", "reviewing")),
      fetchExactCount(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCount(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("status", "rejected")),
      fetchExactCount(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("sex", "male")),
      fetchExactCount(admin.from("dating_1on1_cards").select("id", { count: "exact", head: true }).eq("sex", "female")),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true })),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "proposed")),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "source_selected")),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "candidate_accepted")),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "mutual_accepted")),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "candidate_rejected")),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "source_declined")),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "source_skipped")),
      fetchExactCount(admin.from("dating_1on1_match_proposals").select("id", { count: "exact", head: true }).eq("state", "admin_canceled")),
      fetchExactCount(admin.from("dating_more_view_requests").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCount(admin.from("dating_more_view_requests").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCount(admin.from("dating_more_view_requests").select("id", { count: "exact", head: true }).eq("status", "rejected")),
      fetchExactCount(admin.from("dating_more_view_requests").select("id", { count: "exact", head: true }).eq("status", "approved").gt("access_expires_at", nowIso)),
      fetchExactCount(admin.from("dating_city_view_requests").select("id", { count: "exact", head: true }).eq("status", "pending")),
      fetchExactCount(admin.from("dating_city_view_requests").select("id", { count: "exact", head: true }).eq("status", "approved")),
      fetchExactCount(admin.from("dating_city_view_requests").select("id", { count: "exact", head: true }).eq("status", "rejected")),
      fetchExactCount(admin.from("dating_city_view_requests").select("id", { count: "exact", head: true }).eq("status", "approved").gt("access_expires_at", nowIso)),
      fetchAllRows<RegionRow>((from, to) =>
        admin.from("dating_cards").select("region").eq("status", "public").range(from, to)
      ),
      fetchAllRows<RegionRow>((from, to) =>
        admin.from("dating_1on1_cards").select("region").eq("status", "approved").range(from, to)
      ),
    ]);

    return NextResponse.json({
      ok: true,
      requestId,
      stats: {
        open_cards: {
          total: openTotal,
          pending: openPending,
          public: openPublic,
          hidden: openHidden,
          expired: openExpired,
          male: openMale,
          female: openFemale,
          applications: {
            total: openAppTotal,
            submitted: openAppSubmitted,
            accepted: openAppAccepted,
            rejected: openAppRejected,
            canceled: openAppCanceled,
          },
          top_regions: topRegions(publicOpenRegionRows),
        },
        paid_cards: {
          total: paidTotal,
          pending: paidPending,
          approved: paidApproved,
          rejected: paidRejected,
          expired: paidExpired,
          blur: paidBlur,
          public: paidPublic,
          applications: {
            total: paidAppTotal,
            submitted: paidAppSubmitted,
            accepted: paidAppAccepted,
            rejected: paidAppRejected,
            canceled: paidAppCanceled,
          },
        },
        one_on_one: {
          cards: {
            total: oneOnOneTotal,
            submitted: oneOnOneSubmitted,
            reviewing: oneOnOneReviewing,
            approved: oneOnOneApproved,
            rejected: oneOnOneRejected,
            male: oneOnOneMale,
            female: oneOnOneFemale,
            top_regions: topRegions(approvedOneOnOneRegionRows),
          },
          matches: {
            total: oneOnOneMatchTotal,
            proposed: oneOnOneProposed,
            source_selected: oneOnOneSourceSelected,
            candidate_accepted: oneOnOneCandidateAccepted,
            mutual_accepted: oneOnOneMutualAccepted,
            candidate_rejected: oneOnOneCandidateRejected,
            source_declined: oneOnOneSourceDeclined,
            source_skipped: oneOnOneSourceSkipped,
            admin_canceled: oneOnOneAdminCanceled,
          },
        },
        boosts: {
          more_view: {
            pending: moreViewPending,
            approved: moreViewApproved,
            rejected: moreViewRejected,
            active: moreViewActive,
          },
          city_view: {
            pending: cityViewPending,
            approved: cityViewApproved,
            rejected: cityViewRejected,
            active: cityViewActive,
          },
        },
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/dating/stats] failed", error);
    return NextResponse.json(
      { ok: false, requestId, error: "소개팅 통계를 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}
