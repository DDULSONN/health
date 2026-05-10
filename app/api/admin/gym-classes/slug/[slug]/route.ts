import { NextResponse } from "next/server";
import { requireAdminRoute } from "@/lib/admin-route";

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

  const [{ data: schedules }, { data: applications }, { data: operator }] = await Promise.all([
    auth.admin
      .from("gym_class_schedules")
      .select("*")
      .eq("class_id", item.id)
      .order("sort_order", { ascending: true })
      .order("starts_at", { ascending: true }),
    auth.admin.from("gym_class_applications").select("id,status").eq("class_id", item.id),
    item.operator_id
      ? auth.admin.from("gym_class_operators").select("*").eq("id", item.operator_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    item: {
      ...item,
      schedules: schedules ?? [],
      operator,
      application_count: applications?.length ?? 0,
    },
  });
}
