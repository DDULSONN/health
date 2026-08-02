import { buildSignedImageUrl } from "@/lib/images";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMissingSchemaError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  return code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205";
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const listingsRes = await admin
    .from("reels_dating_listings")
    .select("id,title,description,instagram_url,viewer_access_expires_at")
    .eq("viewer_user_id", user.id)
    .gt("viewer_access_expires_at", nowIso)
    .order("viewer_access_expires_at", { ascending: false })
    .limit(20);

  if (listingsRes.error) {
    if (isMissingSchemaError(listingsRes.error)) {
      return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    console.error("[GET /api/dating/reels/my-access] listings failed", listingsRes.error);
    return NextResponse.json({ error: "릴스 매물 신청 내역을 불러오지 못했습니다." }, { status: 500 });
  }

  const listings = listingsRes.data ?? [];
  const listingIds = listings.map((listing) => String(listing.id));
  if (listingIds.length === 0) {
    return NextResponse.json({ items: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const initialApplicationsRes = await admin
    .from("reels_dating_applications")
    .select(
      "id,listing_id,applicant_display_nickname,age,height_cm,region,job,training_years,instagram_id,intro_text,photo_path,status,created_at"
    )
    .in("listing_id", listingIds)
    .order("created_at", { ascending: false })
    .limit(1000);

  let applicationsData = (initialApplicationsRes.data ?? []) as Array<Record<string, unknown>>;
  let applicationsError = initialApplicationsRes.error;

  if (applicationsError && isMissingSchemaError(applicationsError)) {
    const fallbackApplicationsRes = await admin
      .from("reels_dating_applications")
      .select(
        "id,listing_id,applicant_display_nickname,age,height_cm,region,job,training_years,instagram_id,intro_text,status,created_at"
      )
      .in("listing_id", listingIds)
      .order("created_at", { ascending: false })
      .limit(1000);
    applicationsData = (fallbackApplicationsRes.data ?? []).map((application) => ({
      ...application,
      photo_path: null,
    }));
    applicationsError = fallbackApplicationsRes.error;
  }

  if (applicationsError) {
    console.error("[GET /api/dating/reels/my-access] applications failed", applicationsError);
    return NextResponse.json({ error: "릴스 매물 지원서를 불러오지 못했습니다." }, { status: 500 });
  }

  const applicationsByListing = new Map<string, Array<Record<string, unknown>>>();
  for (const application of applicationsData) {
    const listingId = String(application.listing_id);
    const list = applicationsByListing.get(listingId) ?? [];
    list.push({
      id: application.id,
      applicant_display_nickname: application.applicant_display_nickname,
      age: application.age,
      height_cm: application.height_cm,
      region: application.region,
      job: application.job,
      training_years: application.training_years,
      instagram_id: application.instagram_id,
      intro_text: application.intro_text,
      photo_signed_url:
        "photo_path" in application && typeof application.photo_path === "string" && application.photo_path
          ? buildSignedImageUrl("reels-dating-application-photos", application.photo_path)
          : null,
      status: application.status,
      created_at: application.created_at,
    });
    applicationsByListing.set(listingId, list);
  }

  return NextResponse.json(
    {
      items: listings.map((listing) => ({
        id: listing.id,
        title: listing.title,
        description: listing.description,
        instagram_url: listing.instagram_url,
        access_expires_at: listing.viewer_access_expires_at,
        applications: applicationsByListing.get(String(listing.id)) ?? [],
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
