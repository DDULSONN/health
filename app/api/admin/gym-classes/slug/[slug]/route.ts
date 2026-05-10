import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";
import { buildGymClassApplicationStats } from "@/lib/gym-class-rules";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminRoute();
  if (!auth.ok) return auth.response;

  const { slug } = await context.params;
  const decodedSlug = decodeURIComponent(slug);

  const { data: item, error } = await auth.admin
    .from("gym_classes")
    .select("*")
    .eq("slug", decodedSlug)
    .single();

  if (error || !item) {
    return NextResponse.json({ error: "운동 클래스를 찾지 못했습니다.", detail: error?.message }, { status: 404 });
  }

  const [{ data: schedules }, { data: applications }, { data: operator }, { data: reviews }, { data: inquiries }] = await Promise.all([
    auth.admin
      .from("gym_class_schedules")
      .select("*")
      .eq("class_id", item.id)
      .order("sort_order", { ascending: true })
      .order("starts_at", { ascending: true }),
    auth.admin.from("gym_class_applications").select("id,status,gender,payment_status,paid_amount_krw,refund_amount_krw").eq("class_id", item.id),
    item.operator_id
      ? auth.admin.from("gym_class_operators").select("*").eq("id", item.operator_id).maybeSingle()
      : Promise.resolve({ data: null }),
    auth.admin.from("gym_class_reviews").select("id,rating,content,status,created_at").eq("class_id", item.id).order("created_at", { ascending: false }).limit(20),
    auth.admin.from("gym_class_inquiries").select("id,question,answer,status,created_at,answered_at").eq("class_id", item.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const visibleReviews = (reviews ?? []).filter((review) => review.status === "visible");

  return NextResponse.json({
    item: {
      ...item,
      schedules: schedules ?? [],
      operator,
      reviews: reviews ?? [],
      inquiries: inquiries ?? [],
      application_count: applications?.length ?? 0,
      application_stats: buildGymClassApplicationStats(applications ?? [], item),
      review_stats: {
        count: visibleReviews.length,
        average:
          visibleReviews.length > 0
            ? Math.round((visibleReviews.reduce((sum, review) => sum + Number(review.rating ?? 0), 0) / visibleReviews.length) * 10) / 10
            : null,
      },
    },
  });
}
